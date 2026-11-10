import express from 'express';
import ExcelJS from 'exceljs';
import { db } from '../../db.js';
import {
  DONATION_CATEGORY_KEYS,
  DONATION_CATEGORY_LABEL,
  LIFETIME_FEE_PAISE,
  PAYMENT_MODE_KEYS,
  PAYMENT_MODE_LABEL,
} from '../../config.js';
import { flash, requireSuper } from '../../middleware/auth.js';
import { donationFilters, listDonations, allDonations, getDonation, donationTotals } from '../../lib/donations.js';
import { RECEIPT_REASONS, nextReceiptNo, receiptQr, receiptView, sendDonationThanks } from '../../lib/donation-receipt.js';
import { likeTerm } from '../../lib/members.js';
import { getSite } from '../../lib/settings.js';
import {
  str,
  int,
  bool,
  paginate,
  todayISO,
  isISODate,
  parseAmountPaise,
  formatINR,
  formatDate,
  csvCell,
  normalizePhone,
  formatPhone,
  maskPhone,
} from '../../lib/util.js';

const router = express.Router();
const PER_PAGE = 50;

const queryString = (filters) =>
  new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null)).toString();

const memberStmt = db.prepare('SELECT id, salutation, name, member_no, city, status, phone, whatsapp FROM members WHERE id = ?');
const memberLabel = (m) => [m.salutation, m.name].filter(Boolean).join(' ');

/** Same preference as the thank-you message: WhatsApp number first, then mobile. */
const memberContact = (m) => normalizePhone(m?.whatsapp) || normalizePhone(m?.phone);

/** Sub-admins never receive a member's full number; they only see it masked. */
function memberPhoneFields(m, isSuper) {
  const phone = memberContact(m);
  if (!phone) return { member_phone: '', member_phone_hint: '' };
  return { member_phone: isSuper ? phone.slice(-10) : '', member_phone_hint: isSuper ? formatPhone(phone) : maskPhone(phone) };
}

router.get('/donations', async (req, res) => {
  const filters = donationFilters(req.query);
  const totals = await donationTotals(filters);
  const pg = paginate(totals[filters.category || 'all'].n, int(req.query.page), PER_PAGE);
  const { rows } = await listDonations(filters, { limit: PER_PAGE, offset: pg.offset });
  res.render('admin/donations', {
    pageTitle: 'सहयोग एवं भुगतान',
    filters,
    totals,
    rows,
    pg,
    qs: queryString(filters),
  });
});

/** Approved members for the entry form's search box. Full phone numbers go to super-admins only. */
router.get('/donations/members', async (req, res) => {
  const q = str(req.query.q, 60);
  const where = q
    ? `AND (m.name LIKE @q ESCAPE '\\' OR m.name_en LIKE @q ESCAPE '\\' OR m.member_no LIKE @q ESCAPE '\\' OR m.city LIKE @q ESCAPE '\\')`
    : '';
  const rows = await db
    .prepare(
      `SELECT m.id, m.salutation, m.name, m.member_no, m.city, m.phone, m.whatsapp, md.name AS mandal_name,
              (SELECT COUNT(*) FROM donations d WHERE d.member_id = m.id AND d.category = 'lifetime') AS lifetime_count
       FROM members m LEFT JOIN mandals md ON md.id = m.mandal_id
       WHERE m.status = 'approved' ${where}
       ORDER BY m.name COLLATE NOCASE LIMIT 20`
    )
    .all(q ? { q: likeTerm(q) } : {});
  res.json({
    members: rows.map((m) => ({
      id: m.id,
      name: memberLabel(m),
      member_no: m.member_no || '',
      place: [m.city, m.mandal_name].filter(Boolean).join(' • '),
      lifetime_paid: m.lifetime_count > 0,
      ...memberPhoneFields(m, res.locals.isSuper),
    })),
  });
});

async function blankDonation(query, isSuper) {
  const member = int(query.member) ? await memberStmt.get(int(query.member)) : null;
  return {
    category: DONATION_CATEGORY_KEYS.includes(query.category) ? query.category : 'lifetime',
    payment_mode: 'cash',
    paid_on: todayISO(),
    amount: '',
    phone: member?.status === 'approved' ? memberPhoneFields(member, isSuper).member_phone : '',
    reference: '',
    details: '',
    anonymous: 0,
    send_whatsapp: true,
    ...(member?.status === 'approved' ? { member_id: member.id, name: memberLabel(member), member_no: member.member_no } : {}),
  };
}

/** Paise → "1500" or "1500.50" for the amount input. */
const amountInput = (paise) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

async function renderForm(res, d, errors = []) {
  const member = d.member_id ? await memberStmt.get(d.member_id) : null;
  res.status(errors.length ? 422 : 200).render('admin/donation-form', {
    memberPhone: memberPhoneFields(member, res.locals.isSuper),
    pageTitle: d.id ? 'सहयोग प्रविष्टि संपादित करें' : 'नई सहयोग / भुगतान प्रविष्टि',
    d,
    errors,
    today: todayISO(),
    nextNo: d.id ? null : await nextReceiptNo(),
  });
}

const receiptOwnerStmt = db.prepare('SELECT id, donor_name FROM donations WHERE receipt_no = ? AND id <> ?');

/** Blank means "assign automatically" (new) or "keep as is" (edit). */
async function parseReceiptNo(raw, existingId, errors) {
  if (!raw) return null;
  const n = /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  if (!n) {
    errors.push('रसीद क्रमांक 1 या उससे बड़ी पूर्ण संख्या होनी चाहिए।');
    return null;
  }
  const owner = await receiptOwnerStmt.get(n, existingId || 0);
  if (owner) errors.push(`रसीद क्रमांक ${n} पहले से ${owner.donor_name} की प्रविष्टि को दिया गया है — कोई दूसरा क्रमांक लिखें।`);
  return n;
}

/**
 * Validate the entry form. A donation whose member was later deleted keeps its saved
 * donor name; any newly chosen member must be approved.
 */
async function parseDonation(body, existing = null) {
  const errors = [];
  const memberId = int(body.member_id);
  const member = memberId ? await memberStmt.get(memberId) : null;
  const keepsOldMember = existing && memberId === existing.member_id;
  let donorName = existing?.donor_name || '';
  if (member && (member.status === 'approved' || keepsOldMember)) donorName = memberLabel(member);
  else if (!(existing && !existing.member_id && !memberId)) errors.push('कृपया स्वीकृत सदस्यों में से एक सदस्य चुनें।');

  const category = DONATION_CATEGORY_KEYS.includes(body.category) ? body.category : '';
  if (!category) errors.push('सहयोग की श्रेणी चुनें।');
  const amountPaise = category === 'lifetime' ? LIFETIME_FEE_PAISE : parseAmountPaise(body.amount);
  if (!amountPaise) errors.push('मान्य राशि (₹) दर्ज करें, जैसे 1100 या 501.50।');
  const phoneRaw = category === 'daan' ? str(body.phone, 20) : '';
  const phone = phoneRaw ? normalizePhone(phoneRaw) : '';
  if (phoneRaw && !phone) errors.push('मान्य 10 अंकों का मोबाइल नंबर दर्ज करें।');
  const mode = PAYMENT_MODE_KEYS.includes(body.payment_mode) ? body.payment_mode : '';
  if (!mode) errors.push('भुगतान का प्रकार चुनें।');
  const paidOn = isISODate(body.paid_on) ? body.paid_on : '';
  if (!paidOn) errors.push('भुगतान की तिथि दर्ज करें।');
  else if (paidOn > todayISO()) errors.push('भुगतान की तिथि भविष्य की नहीं हो सकती।');
  const receiptRaw = str(body.receipt_no, 12);
  const receiptNo = await parseReceiptNo(receiptRaw, existing?.id, errors);

  const v = {
    receipt_no: receiptNo,
    member_id: member ? member.id : existing?.member_id ?? null,
    donor_name: donorName,
    category,
    amount_paise: amountPaise,
    phone: phone || null,
    payment_mode: mode,
    reference: str(body.reference, 100),
    details: str(body.details, 200),
    paid_on: paidOn,
    anonymous: bool(body.anonymous),
  };
  const formValues = {
    ...v,
    id: existing?.id,
    name: donorName,
    member_no: member?.member_no || existing?.member_no || '',
    amount: str(body.amount, 20),
    phone: phoneRaw,
    receipt_no: receiptRaw,
  };
  return { v, errors, formValues };
}

router.get('/donations/new', async (req, res) => renderForm(res, await blankDonation(req.query, res.locals.isSuper)));

const insertDonation = db.prepare(
  `INSERT INTO donations (member_id, donor_name, category, amount_paise, phone, payment_mode, reference, details, paid_on, anonymous, admin_id, receipt_no)
   VALUES (@member_id, @donor_name, @category, @amount_paise, @phone, @payment_mode, @reference, @details, @paid_on, @anonymous, @admin_id, @receipt_no)`
);

const isDuplicateReceipt = (err) => err?.code === '23505';
const duplicateReceiptError = (n) => `रसीद क्रमांक ${n} अभी-अभी किसी दूसरी प्रविष्टि को दिया गया — कोई दूसरा क्रमांक लिखें।`;

/** Two admins saving at the same moment can race for an automatic रसीद क्रमांक; the unique index makes one retry. */
async function insertWithReceiptNo(row) {
  if (row.receipt_no) {
    const info = await insertDonation.run(row);
    return { id: Number(info.lastInsertRowid), receiptNo: row.receipt_no };
  }
  for (let attempt = 1; ; attempt++) {
    const receiptNo = await nextReceiptNo();
    try {
      const info = await insertDonation.run({ ...row, receipt_no: receiptNo });
      return { id: Number(info.lastInsertRowid), receiptNo };
    } catch (err) {
      if (!isDuplicateReceipt(err) || attempt >= 3) throw err;
    }
  }
}

function whatsappNote(result) {
  if (!result.ok) return ` व्हाट्सऐप संदेश नहीं भेजा जा सका: ${result.error}`;
  if (result.pdfError) return ` धन्यवाद संदेश व्हाट्सऐप पर भेजा गया, पर PDF रसीद नहीं जा सकी: ${result.pdfError}`;
  return ' धन्यवाद संदेश व PDF रसीद व्हाट्सऐप पर भेजी गई।';
}

const whatsappFlashType = (result, failType) => (!result.ok ? failType : result.pdfError ? 'warn' : 'success');

router.post('/donations', async (req, res) => {
  const { v, errors, formValues } = await parseDonation(req.body ?? {});
  const again = { ...formValues, send_whatsapp: bool(req.body?.send_whatsapp) };
  if (errors.length) return renderForm(res, again, errors);
  let saved;
  try {
    saved = await insertWithReceiptNo({ ...v, admin_id: req.admin.id });
  } catch (err) {
    if (isDuplicateReceipt(err) && v.receipt_no) return renderForm(res, again, [duplicateReceiptError(v.receipt_no)]);
    throw err;
  }
  const { id, receiptNo } = saved;
  let msg = `${v.donor_name} की ${formatINR(v.amount_paise)} की प्रविष्टि (${DONATION_CATEGORY_LABEL[v.category]}) सहेजी गई — रसीद क्रमांक ${receiptNo}।`;
  let type = 'success';
  if (bool(req.body?.send_whatsapp)) {
    const result = await sendDonationThanks(id);
    msg += whatsappNote(result);
    type = whatsappFlashType(result, 'warn');
    if (type !== 'success') msg += ' — सूची में व्हाट्सऐप बटन से दोबारा भेज सकते हैं।';
  }
  flash(req, type, msg);
  res.redirect(req.body?.again ? `/admin/donations/new?category=${v.category}` : `/admin/donations?category=${v.category}`);
});

router.post('/donations/:id/whatsapp', async (req, res, next) => {
  const d = await getDonation(req.params.id);
  if (!d) return next();
  const result = await sendDonationThanks(d.id);
  flash(req, whatsappFlashType(result, 'error'), `रसीद ${d.receipt_no} (${d.name}):${whatsappNote(result)}`);
  res.redirect(String(req.body?.back || '').startsWith('/admin/donations') ? req.body.back : '/admin/donations');
});

/* ---------- Printable रसीद ---------- */

function receiptIds(value) {
  return [...new Set([].concat(value || []).flatMap((v) => String(v).split(',')).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
}

router.get('/donations/receipts', async (req, res) => {
  const ids = receiptIds(req.query.ids);
  const rows = [];
  for (const id of ids) {
    const d = await getDonation(id);
    if (d) rows.push(d);
  }
  rows.sort((a, b) => a.receipt_no - b.receipt_no);
  if (!rows.length) {
    flash(req, 'error', 'रसीद प्रिंट करने के लिए कम से कम एक प्रविष्टि चुनें।');
    return res.redirect('/admin/donations');
  }
  const site = await getSite();
  const showPhone = req.admin.role === 'superadmin' ? formatPhone : maskPhone;
  res.render('admin/receipt-print', {
    site,
    receipts: rows.map((d) => receiptView(d, showPhone)),
    reasons: RECEIPT_REASONS,
    qr: await receiptQr(site),
  });
});

router.get('/donations/:id/edit', async (req, res, next) => {
  const d = await getDonation(req.params.id);
  if (!d) return next();
  return renderForm(res, { ...d, amount: amountInput(d.amount_paise), phone: d.phone ? d.phone.slice(-10) : '' });
});

const updateDonation = db.prepare(
  `UPDATE donations SET member_id = @member_id, donor_name = @donor_name, category = @category, amount_paise = @amount_paise,
     phone = @phone, payment_mode = @payment_mode, reference = @reference, details = @details, paid_on = @paid_on, anonymous = @anonymous,
     receipt_no = COALESCE(@receipt_no, receipt_no), updated_by = @updated_by, updated_at = CURRENT_TIMESTAMP
   WHERE id = @id`
);

router.post('/donations/:id', async (req, res, next) => {
  const existing = await getDonation(req.params.id);
  if (!existing) return next();
  const { v, errors, formValues } = await parseDonation(req.body ?? {}, existing);
  if (errors.length) return renderForm(res, formValues, errors);
  try {
    await updateDonation.run({ ...v, updated_by: req.admin.id, id: existing.id });
  } catch (err) {
    if (isDuplicateReceipt(err) && v.receipt_no) return renderForm(res, formValues, [duplicateReceiptError(v.receipt_no)]);
    throw err;
  }
  const finalNo = v.receipt_no || existing.receipt_no;
  flash(
    req,
    'success',
    finalNo !== existing.receipt_no ? `प्रविष्टि अपडेट की गई — रसीद क्रमांक ${existing.receipt_no} से ${finalNo} किया गया।` : 'प्रविष्टि अपडेट की गई।'
  );
  res.redirect(`/admin/donations?category=${v.category}`);
});

router.post('/donations/:id/delete', requireSuper, async (req, res) => {
  const d = await getDonation(req.params.id);
  if (d) {
    await db.prepare('DELETE FROM donations WHERE id = ?').run(d.id);
    flash(req, 'success', `${d.name} की ${formatINR(d.amount_paise)} की प्रविष्टि हटाई गई।`);
  }
  res.redirect(`/admin/donations${d ? `?category=${d.category}` : ''}`);
});

/* ---------- Ledger export ---------- */

const EXPORT_COLUMNS = [
  ['sr', 'क्रम संख्या', 8],
  ['receipt_no', 'रसीद क्रमांक', 12],
  ['paid_on_out', 'दिनांक', 14],
  ['member_no', 'सदस्य क्रमांक', 14],
  ['name', 'सदस्य का नाम', 28],
  ['mandal_name', 'मंडल', 18],
  ['category_out', 'श्रेणी', 20],
  ['amount', 'राशि (₹)', 14],
  ['phone_out', 'मोबाइल नंबर', 18],
  ['mode_out', 'भुगतान प्रकार', 16],
  ['reference', 'संदर्भ संख्या', 22],
  ['details', 'लेन-देन विवरण', 32],
  ['anonymous_out', 'गुप्त सहयोग', 10],
  ['entered_by', 'प्रविष्टि कर्ता', 18],
];

async function exportRows(req) {
  const showPhone = req.admin.role === 'superadmin' ? formatPhone : maskPhone;
  return (await allDonations(donationFilters(req.query))).map((d, i) => ({
    ...d,
    sr: i + 1,
    paid_on_out: formatDate(d.paid_on, 'numeric'),
    category_out: DONATION_CATEGORY_LABEL[d.category] || d.category,
    amount: d.amount_paise / 100,
    phone_out: d.phone || d.member_phone ? showPhone(d.phone || d.member_phone) : '',
    mode_out: PAYMENT_MODE_LABEL[d.payment_mode] || d.payment_mode,
    anonymous_out: d.anonymous ? 'हाँ' : '',
    entered_by: d.admin_name || d.admin_username || '',
  }));
}

const exportName = (req, ext) => {
  const cat = DONATION_CATEGORY_KEYS.includes(req.query.category) ? `-${req.query.category}` : '';
  return `donations${cat}-${todayISO()}.${ext}`;
};

router.get('/donations/export.csv', async (req, res) => {
  const rows = await exportRows(req);
  const lines = [EXPORT_COLUMNS.map(([, label]) => csvCell(label)).join(',')];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map(([key]) => csvCell(key === 'amount' ? r.amount.toFixed(2) : r[key])).join(','));
  const total = rows.reduce((s, r) => s + r.amount_paise, 0);
  lines.push(EXPORT_COLUMNS.map(([key]) => csvCell(key === 'name' ? 'कुल' : key === 'amount' ? (total / 100).toFixed(2) : '')).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${exportName(req, 'csv')}"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

router.get('/donations/export.xlsx', async (req, res) => {
  const rows = await exportRows(req);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Awadh Rajput Vikas Sangh';
  const ws = wb.addWorksheet('सहयोग खाता');
  ws.columns = EXPORT_COLUMNS.map(([key, header, width]) => ({ header, key, width }));
  // Excel has no lakh grouping; these conditional sections render ₹1,00,000.00 style.
  ws.getColumn('amount').numFmt = '[>=10000000]"₹"##\\,##\\,##\\,##0.00;[>=100000]"₹"##\\,##\\,##0.00;"₹"##,##0.00';
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B1E1E' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(EXPORT_COLUMNS.map(([key]) => [key, r[key] ?? ''])));
  const totalRow = ws.addRow({ name: 'कुल', amount: rows.reduce((s, r) => s + r.amount_paise, 0) / 100 });
  totalRow.font = { bold: true };
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="${exportName(req, 'xlsx')}"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;

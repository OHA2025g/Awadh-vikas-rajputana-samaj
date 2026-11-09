import express from 'express';
import ExcelJS from 'exceljs';
import QRCode from 'qrcode';
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
import { RECEIPT_REASONS, donationPhone, nextReceiptNo, sendDonationThanks } from '../../lib/donation-receipt.js';
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
  amountInWordsHi,
} from '../../lib/util.js';

const router = express.Router();
const PER_PAGE = 50;

const queryString = (filters) =>
  new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null)).toString();

const memberStmt = db.prepare('SELECT id, salutation, name, member_no, city, status FROM members WHERE id = ?');
const memberLabel = (m) => [m.salutation, m.name].filter(Boolean).join(' ');

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

/** Approved members for the entry form's search box. Phone numbers are deliberately not returned. */
router.get('/donations/members', async (req, res) => {
  const q = str(req.query.q, 60);
  const where = q
    ? `AND (m.name LIKE @q ESCAPE '\\' OR m.name_en LIKE @q ESCAPE '\\' OR m.member_no LIKE @q ESCAPE '\\' OR m.city LIKE @q ESCAPE '\\')`
    : '';
  const rows = await db
    .prepare(
      `SELECT m.id, m.salutation, m.name, m.member_no, m.city, md.name AS mandal_name,
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
    })),
  });
});

async function blankDonation(query) {
  const member = int(query.member) ? await memberStmt.get(int(query.member)) : null;
  return {
    category: DONATION_CATEGORY_KEYS.includes(query.category) ? query.category : 'lifetime',
    payment_mode: 'cash',
    paid_on: todayISO(),
    amount: '',
    phone: '',
    reference: '',
    details: '',
    anonymous: 0,
    send_whatsapp: true,
    ...(member?.status === 'approved' ? { member_id: member.id, name: memberLabel(member), member_no: member.member_no } : {}),
  };
}

/** Paise → "1500" or "1500.50" for the amount input. */
const amountInput = (paise) => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

function renderForm(res, d, errors = []) {
  res.status(errors.length ? 422 : 200).render('admin/donation-form', {
    pageTitle: d.id ? 'सहयोग प्रविष्टि संपादित करें' : 'नई सहयोग / भुगतान प्रविष्टि',
    d,
    errors,
    today: todayISO(),
  });
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

  const v = {
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
  };
  return { v, errors, formValues };
}

router.get('/donations/new', async (req, res) => renderForm(res, await blankDonation(req.query)));

const insertDonation = db.prepare(
  `INSERT INTO donations (member_id, donor_name, category, amount_paise, phone, payment_mode, reference, details, paid_on, anonymous, admin_id, receipt_no)
   VALUES (@member_id, @donor_name, @category, @amount_paise, @phone, @payment_mode, @reference, @details, @paid_on, @anonymous, @admin_id, @receipt_no)`
);

/** Two admins saving at the same moment can race for a रसीद क्रमांक; the unique index makes one retry. */
async function insertWithReceiptNo(row) {
  for (let attempt = 1; ; attempt++) {
    const receiptNo = await nextReceiptNo();
    try {
      const info = await insertDonation.run({ ...row, receipt_no: receiptNo });
      return { id: Number(info.lastInsertRowid), receiptNo };
    } catch (err) {
      if (err?.code !== '23505' || attempt >= 3) throw err;
    }
  }
}

const whatsappNote = (result) =>
  result.ok ? ' धन्यवाद संदेश व्हाट्सऐप पर भेजा गया।' : ` व्हाट्सऐप संदेश नहीं भेजा जा सका: ${result.error}`;

router.post('/donations', async (req, res) => {
  const { v, errors, formValues } = await parseDonation(req.body ?? {});
  if (errors.length) return renderForm(res, { ...formValues, send_whatsapp: bool(req.body?.send_whatsapp) }, errors);
  const { id, receiptNo } = await insertWithReceiptNo({ ...v, admin_id: req.admin.id });
  let msg = `${v.donor_name} की ${formatINR(v.amount_paise)} की प्रविष्टि (${DONATION_CATEGORY_LABEL[v.category]}) सहेजी गई — रसीद क्रमांक ${receiptNo}।`;
  let type = 'success';
  if (bool(req.body?.send_whatsapp)) {
    const result = await sendDonationThanks(id);
    msg += whatsappNote(result);
    if (!result.ok) {
      msg += ' — सूची में व्हाट्सऐप बटन से दोबारा भेज सकते हैं।';
      type = 'warn';
    }
  }
  flash(req, type, msg);
  res.redirect(req.body?.again ? `/admin/donations/new?category=${v.category}` : `/admin/donations?category=${v.category}`);
});

router.post('/donations/:id/whatsapp', async (req, res, next) => {
  const d = await getDonation(req.params.id);
  if (!d) return next();
  const result = await sendDonationThanks(d.id);
  flash(req, result.ok ? 'success' : 'error', `रसीद ${d.receipt_no} (${d.name}):${whatsappNote(result)}`);
  res.redirect(String(req.body?.back || '').startsWith('/admin/donations') ? req.body.back : '/admin/donations');
});

/* ---------- Printable रसीद ---------- */

function receiptIds(value) {
  return [...new Set([].concat(value || []).flatMap((v) => String(v).split(',')).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
}

async function receiptQr(site) {
  if (site.receipt_qr) return site.receipt_qr;
  if (!site.upi_id) return '';
  const params = new URLSearchParams({ pa: site.upi_id, pn: site.org_name_en || site.org_name, cu: 'INR' });
  return QRCode.toDataURL(`upi://pay?${params}`, { margin: 0, width: 240 });
}

router.get('/donations/receipts', async (req, res) => {
  const ids = receiptIds(req.query.ids);
  const rows = [];
  for (const id of ids) {
    const d = await getDonation(id);
    if (d) rows.push(d);
  }
  if (!rows.length) {
    flash(req, 'error', 'रसीद प्रिंट करने के लिए कम से कम एक प्रविष्टि चुनें।');
    return res.redirect('/admin/donations');
  }
  const site = await getSite();
  const showPhone = req.admin.role === 'superadmin' ? formatPhone : maskPhone;
  const receipts = rows.map((d) => {
    const phone = donationPhone(d);
    return {
      ...d,
      date_out: formatDate(d.paid_on, 'numeric'),
      phone_out: phone ? showPhone(phone) : '',
      residence: d.member_address || d.member_city || '',
      amount_out: formatINR(d.amount_paise),
      words_out: amountInWordsHi(d.amount_paise),
      mode_out: [PAYMENT_MODE_LABEL[d.payment_mode] || d.payment_mode, d.reference].filter(Boolean).join(' — '),
    };
  });
  res.render('admin/receipt-print', { site, receipts, reasons: RECEIPT_REASONS, qr: await receiptQr(site) });
});

router.get('/donations/:id/edit', async (req, res, next) => {
  const d = await getDonation(req.params.id);
  if (!d) return next();
  renderForm(res, { ...d, amount: amountInput(d.amount_paise), phone: d.phone ? d.phone.slice(-10) : '' });
});

router.post('/donations/:id', async (req, res, next) => {
  const existing = await getDonation(req.params.id);
  if (!existing) return next();
  const { v, errors, formValues } = await parseDonation(req.body ?? {}, existing);
  if (errors.length) return renderForm(res, formValues, errors);
  await db.prepare(
    `UPDATE donations SET member_id = @member_id, donor_name = @donor_name, category = @category, amount_paise = @amount_paise,
       phone = @phone, payment_mode = @payment_mode, reference = @reference, details = @details, paid_on = @paid_on, anonymous = @anonymous,
       updated_by = @updated_by, updated_at = CURRENT_TIMESTAMP
     WHERE id = @id`
  ).run({ ...v, updated_by: req.admin.id, id: existing.id });
  flash(req, 'success', 'प्रविष्टि अपडेट की गई।');
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

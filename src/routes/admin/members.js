import express from 'express';
import ExcelJS from 'exceljs';
import { db, tx } from '../../db.js';
import { CATEGORY_KEYS, CATEGORY_LABEL, SALUTATIONS, GENDERS, STATUS_LABEL } from '../../config.js';
import { flash, requireSuper } from '../../middleware/auth.js';
import {
  listMembers,
  allMembers,
  getMember,
  approveMember,
  nextApplicationNo,
  categoryCounts,
  markCertificatesPrinted,
  clearCertificatesPrinted,
} from '../../lib/members.js';
import { parseFormFields, formRows } from '../../lib/membership-form.js';
import { alignMandal, setMembersMandal } from '../../lib/mandals.js';
import { fileFor, saveImage, removeUpload, privatePath } from '../../lib/uploads.js';
import {
  str,
  text,
  int,
  bool,
  normalizePhone,
  paginate,
  maskPhone,
  formatPhone,
  maskAadhaar,
  formatAadhaar,
  formatDate,
  csvCell,
  isISODate,
  todayISO,
  isoDate,
} from '../../lib/util.js';

const router = express.Router();

const mandals = async () => await db.prepare('SELECT * FROM mandals ORDER BY sort_order, id').all();
const committees = async () => await db.prepare('SELECT * FROM committees ORDER BY sort_order, id').all();

function filtersFrom(query, defaults = {}) {
  return {
    status: ['pending', 'approved', 'rejected'].includes(query.status) ? query.status : defaults.status ?? 'approved',
    category: CATEGORY_KEYS.includes(query.category) ? query.category : '',
    mandal: int(query.mandal) || '',
    committee: int(query.committee) || '',
    cert: ['printed', 'unprinted'].includes(query.cert) ? query.cert : '',
    q: str(query.q, 60),
  };
}

/* ---------- Private files (applicant signatures) ---------- */

router.get('/private/:file', async (req, res, next) => {
  const file = privatePath(req.params.file);
  if (!file) return next();
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(file, (err) => err && next());
});

/* ---------- Applications ---------- */

router.get('/applications', async (req, res) => {
  const status = req.query.status === 'rejected' ? 'rejected' : 'pending';
  const { rows } = await listMembers({ status }, { limit: 500, order: 'recent' });
  res.render('admin/applications', { pageTitle: 'सदस्यता आवेदन', rows, status });
});

router.get('/applications/:id', async (req, res, next) => {
  const m = await getMember(req.params.id);
  if (!m) return next();
  res.render('admin/application', {
    pageTitle: `आवेदन ${m.application_no || ''}`,
    extraStyles: ['/css/membership-form.css'],
    m,
    formDate: formatDate(m.created_at, 'numeric'),
    mandals: await mandals(),
    committees: await committees(),
  });
});

/** The filled-in सदस्यता फॉर्म on its own page, for printing on A4. */
router.get('/members/:id/form', async (req, res, next) => {
  const m = await getMember(req.params.id);
  if (!m) return next();
  res.render('admin/form-print', { m, formDate: formatDate(m.created_at, 'numeric') });
});

router.post('/applications/:id/approve', async (req, res) => {
  const id = int(req.params.id);
  const b = req.body ?? {};
  const m = await getMember(id);
  const has = (k) => b[k] !== undefined;
  const pickedMandal = has('mandal_id') ? int(b.mandal_id) : m?.mandal_id;
  const memberNo =
    m &&
    (await approveMember(id, {
      category: CATEGORY_KEYS.includes(b.category) ? b.category : m.category || 'sadasya',
      designation: has('designation') ? str(b.designation, 80) || null : m.designation,
      mandal_id: pickedMandal,
      committee_id: has('committee_id') ? int(b.committee_id) : m.committee_id,
      show_in_directory: has('show_in_directory') || has('category') ? bool(b.show_in_directory) : 1,
    }));
  if (memberNo && pickedMandal && pickedMandal !== m.mandal_id) await setMembersMandal([id], pickedMandal);
  if (!memberNo) {
    flash(req, 'error', 'आवेदन नहीं मिला।');
  } else {
    flash(req, 'success', `आवेदन स्वीकृत किया गया। सदस्य क्रमांक: ${memberNo}`);
  }
  res.redirect(b.back === 'list' ? '/admin/applications' : `/admin/members/${id}/edit`);
});

router.post('/applications/:id/reject', async (req, res) => {
  await db.prepare("UPDATE members SET status = 'rejected', reject_reason = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    str(req.body?.reason, 300) || null,
    int(req.params.id)
  );
  flash(req, 'success', 'आवेदन अस्वीकृत किया गया।');
  res.redirect('/admin/applications');
});

/* ---------- Members list ---------- */

router.get('/members', async (req, res) => {
  const filters = filtersFrom(req.query);
  const { total } = await listMembers(filters, { limit: 0 });
  const pg = paginate(total, int(req.query.page, 1), 50);
  const { rows } = await listMembers(filters, { limit: pg.perPage, offset: pg.offset });
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '' && v != null)).toString();
  res.render('admin/members', {
    pageTitle: 'सदस्य सूची',
    rows,
    filters,
    pg,
    qs,
    mandals: await mandals(),
    committees: await committees(),
    counts: await categoryCounts({ publicOnly: false, status: filters.status }),
  });
});

/* ---------- Create / edit ---------- */

function parseMember(body, isSuper) {
  const { v: formFields, errors: fieldErrors } = parseFormFields(body);
  const v = {
    ...formFields,
    salutation: SALUTATIONS.includes(body.salutation) ? body.salutation : null,
    name_en: str(body.name_en, 80) || null,
    gender: GENDERS.includes(body.gender) ? body.gender : null,
    dob: /^\d{4}-\d{2}-\d{2}$/.test(body.dob || '') ? body.dob : null,
    occupation: str(body.occupation, 80) || null,
    education: str(body.education, 80) || null,
    mandal_id: int(body.mandal_id),
    committee_id: int(body.committee_id),
    category: CATEGORY_KEYS.includes(body.category) ? body.category : 'sadasya',
    designation: str(body.designation, 80) || null,
    show_in_directory: bool(body.show_in_directory),
    sort_order: int(body.sort_order, 0),
    admin_notes: text(body.admin_notes, 1000) || null,
  };
  // Sub-admins only see masked Aadhaar / phone numbers, so they cannot edit fields that contain them.
  if (!isSuper) {
    delete v.aadhaar;
    delete v.family;
    delete v.relatives;
  }
  const errors = Object.values(fieldErrors);
  // Only the admin member form posts this. The public join page keeps today's date.
  if (Object.prototype.hasOwnProperty.call(body, 'form_date')) {
    const raw = String(body.form_date || '').trim();
    if (!isISODate(raw) || raw > todayISO()) errors.push('दिनांक आज की तारीख या उससे पहले चुनें।');
    else v.created_at = raw;
  }
  if (isSuper) {
    v.phone = normalizePhone(body.phone);
    v.whatsapp = normalizePhone(body.whatsapp) || v.phone;
    if (!v.phone) errors.push('मान्य 10 अंकों का मोबाइल नंबर आवश्यक है।');
  }
  return { v, errors };
}

function formStamp(m) {
  const picked = isISODate(m.form_date) ? m.form_date : '';
  const iso = picked || isoDate(m.created_at) || todayISO();
  return {
    formDate: formatDate(iso, 'numeric'),
    formDateIso: iso,
    formDateMax: todayISO(),
  };
}

async function renderForm(res, m, extra = {}) {
  res.render('admin/member-form', {
    pageTitle: m.id ? `सदस्य संपादन — ${m.name}` : 'नया सदस्य जोड़ें',
    extraStyles: ['/css/membership-form.css'],
    m,
    ...formStamp(m),
    mandals: await mandals(),
    committees: await committees(),
    SALUTATIONS,
    GENDERS,
    errors: [],
    ...extra,
  });
}

router.get('/members/new', requireSuper, async (req, res) => {
  await renderForm(res, { status: 'approved', category: 'sadasya', show_in_directory: 1, sort_order: 0 });
});

router.post('/members', requireSuper, async (req, res) => {
  const { v, errors } = parseMember(req.body ?? {}, true);
  if (v.phone && await db.prepare("SELECT 1 FROM members WHERE phone = ? AND status != 'rejected'").get(v.phone)) {
    errors.push('इस मोबाइल नंबर से सदस्य पहले से मौजूद है।');
  }
  if (errors.length) return await renderForm(res, { ...v, ...req.body, id: null }, { errors });
  await alignMandal(v);
  const photoFile = fileFor(req, 'photo');
  const photo = photoFile ? saveImage(photoFile.buffer) : null;
  const id = await tx(async () => {
    const row = { ...v, photo };
    if (v.created_at) row.approved_at = v.created_at;
    const cols = Object.keys(row);
    const info = await db
      .prepare(`INSERT INTO members (status, ${cols.join(', ')}) VALUES ('pending', ${cols.map((c) => `@${c}`).join(', ')})`)
      .run(row);
    const newId = info.lastInsertRowid;
    await db.prepare('UPDATE members SET application_no = ? WHERE id = ?').run(nextApplicationNo(newId), newId);
    await approveMember(newId, v);
    return newId;
  });
  flash(req, 'success', 'नया सदस्य जोड़ा गया।');
  res.redirect(`/admin/members/${id}/edit`);
});

router.post('/members/bulk', async (req, res) => {
  const body = req.body ?? {};
  const qs = String(body.qs || '').replace(/[^\w=&%.+-]/g, '');
  const ids =
    body.all_matching === '1'
      ? (await allMembers(filtersFrom(Object.fromEntries(new URLSearchParams(qs))))).map((m) => m.id)
      : [].concat(body.ids || []).map(Number).filter(Number.isInteger);
  const back = `/admin/members${qs ? `?${qs}` : ''}`;
  if (!ids.length) {
    flash(req, 'error', 'कोई सदस्य नहीं चुना गया।');
    return res.redirect(back);
  }
  const placeholders = ids.map(() => '?').join(',');
  switch (body.action) {
    case 'category':
      if (CATEGORY_KEYS.includes(body.category)) {
        await db.prepare(`UPDATE members SET category = ? WHERE id IN (${placeholders})`).run(body.category, ...ids);
        flash(req, 'success', `${ids.length} सदस्यों की श्रेणी "${CATEGORY_LABEL[body.category]}" की गई।`);
      }
      break;
    case 'mandal': {
      const mandalId = int(body.mandal_id);
      if (mandalId) {
        await setMembersMandal(ids, mandalId);
        flash(req, 'success', `${ids.length} सदस्यों का मंडल (विधानसभा) बदला गया।`);
      }
      break;
    }
    case 'hide':
    case 'show':
      await db.prepare(`UPDATE members SET show_in_directory = ? WHERE id IN (${placeholders})`).run(body.action === 'show' ? 1 : 0, ...ids);
      flash(req, 'success', 'निर्देशिका दृश्यता अपडेट की गई।');
      break;
    case 'cert_printed':
      flash(req, 'success', `${await markCertificatesPrinted(ids, req.admin.id)} सदस्यों का प्रमाण पत्र "छपा" चिह्नित किया गया।`);
      break;
    case 'cert_unprinted':
      flash(req, 'success', `${await clearCertificatesPrinted(ids)} सदस्यों का प्रमाण पत्र "नहीं छपा" चिह्नित किया गया।`);
      break;
    case 'delete': {
      if (req.admin.role !== 'superadmin') {
        flash(req, 'error', 'सदस्य हटाने का अधिकार केवल मुख्य एडमिन को है।');
        break;
      }
      const files = await db.prepare(`SELECT photo, signature FROM members WHERE id IN (${placeholders})`).all(...ids);
      await db.prepare(`DELETE FROM members WHERE id IN (${placeholders})`).run(...ids);
      for (const f of files) {
        removeUpload(f.photo);
        removeUpload(f.signature);
      }
      flash(req, 'success', `${ids.length} सदस्य हटाए गए।`);
      break;
    }
    default:
      flash(req, 'error', 'कृपया कोई कार्य चुनें।');
  }
  res.redirect(back);
});

router.get('/members/:id/edit', async (req, res, next) => {
  const m = await getMember(req.params.id);
  if (!m) return next();
  const certLog = await db
    .prepare(
      'SELECT l.*, a.name AS admin_name FROM certificate_log l LEFT JOIN admins a ON a.id = l.admin_id WHERE l.member_id = ? ORDER BY l.id DESC LIMIT 10'
    )
    .all(m.id);
  await renderForm(res, m, { certLog });
});

router.post('/members/:id', async (req, res, next) => {
  const existing = await getMember(req.params.id);
  if (!existing) return next();
  const isSuper = req.admin.role === 'superadmin';
  const body = req.body ?? {};
  const { v, errors } = parseMember(body, isSuper);
  if (isSuper) {
    const dup = await db
      .prepare("SELECT 1 FROM members WHERE phone = ? AND id != ? AND status != 'rejected'")
      .get(v.phone, existing.id);
    if (dup) errors.push('यह मोबाइल नंबर किसी अन्य सदस्य के नाम पर है।');
  }
  if (errors.length) return await renderForm(res, { ...existing, ...v, form_date: body.form_date }, { errors });
  await alignMandal(v);

  let photo = existing.photo;
  const photoFile = fileFor(req, 'photo');
  if (photoFile) {
    photo = saveImage(photoFile.buffer);
    removeUpload(existing.photo);
  } else if (body.remove_photo) {
    removeUpload(existing.photo);
    photo = null;
  }

  const fields = Object.keys(v);
  await db.prepare(
    `UPDATE members SET ${fields.map((f) => `${f} = @${f}`).join(', ')}, photo = @photo, updated_at = CURRENT_TIMESTAMP WHERE id = @id`
  ).run({ ...v, photo, id: existing.id });

  if (body.status && body.status !== existing.status) {
    if (body.status === 'approved') await approveMember(existing.id, { ...v });
    else if (['pending', 'rejected'].includes(body.status)) {
      await db.prepare('UPDATE members SET status = ? WHERE id = ?').run(body.status, existing.id);
    }
  }
  flash(req, 'success', 'सदस्य की जानकारी सहेजी गई।');
  res.redirect(`/admin/members/${existing.id}/edit`);
});

router.post('/members/:id/delete', requireSuper, async (req, res) => {
  const m = await getMember(req.params.id);
  if (m) {
    await db.prepare('DELETE FROM members WHERE id = ?').run(m.id);
    removeUpload(m.photo);
    removeUpload(m.signature);
    flash(req, 'success', `${m.name} को हटा दिया गया।`);
  }
  res.redirect(req.body?.back === 'applications' ? '/admin/applications' : '/admin/members');
});

/* ---------- Export ---------- */

const EXPORT_COLUMNS = [
  ['member_no', 'सदस्य क्रमांक'],
  ['application_no', 'आवेदन क्रमांक'],
  ['salutation', 'संबोधन'],
  ['name', 'नाम'],
  ['name_en', 'नाम (अंग्रेज़ी)'],
  ['age', 'उम्र'],
  ['aadhaar_out', 'आधार कार्ड नं.'],
  ['vansh', 'वंश'],
  ['gotra', 'गोत्र'],
  ['father_name', 'माता / पिता या पति का नाम'],
  ['category_label', 'श्रेणी'],
  ['designation', 'पद'],
  ['mandal_name', 'मंडल'],
  ['committee_name', 'समिति'],
  ['phone_out', 'मोबाइल'],
  ['whatsapp_out', 'व्हाट्सऐप'],
  ['email', 'ईमेल'],
  ['perm_village', 'स्थायी पता (उ.प्र.) — ग्राम'],
  ['perm_post', 'पोस्ट'],
  ['perm_block', 'ब्लॉक'],
  ['perm_tehsil', 'तहसील'],
  ['perm_district', 'जिला (स्थायी)'],
  ['perm_pincode', 'पिनकोड (स्थायी)'],
  ['address', 'वर्तमान पता'],
  ['ward_no', 'प्रभाग नंबर'],
  ['vidhan_sabha', 'विधानसभा'],
  ['district', 'जिला (वर्तमान)'],
  ['state', 'प्रदेश'],
  ['country', 'राष्ट्र'],
  ['pincode', 'पिनकोड (वर्तमान)'],
  ['city', 'शहर / क्षेत्र'],
  ['family_out', 'पारिवारिक विवरण'],
  ['relatives_out', 'गाँव के रिलेशन'],
  ['native_place', 'पैतृक स्थान'],
  ['occupation', 'व्यवसाय'],
  ['education', 'शिक्षा'],
  ['dob', 'जन्म तिथि'],
  ['gender', 'लिंग'],
  ['status_label', 'स्थिति'],
  ['created_on', 'आवेदन तिथि'],
  ['approved_on', 'स्वीकृति तिथि'],
];

async function exportRows(req) {
  const isSuper = req.admin.role === 'superadmin';
  const phoneOut = isSuper ? formatPhone : maskPhone;
  const rowsOut = (json) =>
    formRows(json)
      .map((r) => [r.name, r.relation, r.age && `${r.age} वर्ष`, r.address, r.phone && phoneOut(r.phone)].filter(Boolean).join(', '))
      .join(' | ');
  return (await allMembers(filtersFrom(req.query))).map((m) => ({
    ...m,
    category_label: CATEGORY_LABEL[m.category],
    status_label: STATUS_LABEL[m.status],
    phone_out: phoneOut(m.phone),
    whatsapp_out: phoneOut(m.whatsapp),
    aadhaar_out: isSuper ? formatAadhaar(m.aadhaar) : maskAadhaar(m.aadhaar),
    family_out: rowsOut(m.family),
    relatives_out: rowsOut(m.relatives),
    created_on: formatDate(m.created_at, 'short'),
    approved_on: formatDate(m.approved_at, 'short'),
  }));
}

router.get('/members/export.csv', async (req, res) => {
  const rows = await exportRows(req);
  const lines = [EXPORT_COLUMNS.map(([, label]) => csvCell(label)).join(',')];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map(([key]) => csvCell(r[key])).join(','));
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(`\uFEFF${lines.join('\r\n')}`);
});

router.get('/members/export.xlsx', async (req, res) => {
  const rows = await exportRows(req);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Awadh Rajput Vikas Sangh';
  const ws = wb.addWorksheet('सदस्य');
  ws.columns = EXPORT_COLUMNS.map(([key, header]) => ({ header, key, width: Math.max(12, header.length + 6) }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B1E1E' } };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of rows) ws.addRow(Object.fromEntries(EXPORT_COLUMNS.map(([key]) => [key, r[key] ?? ''])));
  res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.set('Content-Disposition', `attachment; filename="members-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

export default router;

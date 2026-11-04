import express from 'express';
import { db, tx } from '../../db.js';
import { CATEGORY_KEYS, CATEGORY_LABEL } from '../../config.js';
import { listMembers, markCertificatesPrinted, clearCertificatesPrinted } from '../../lib/members.js';
import { getCalibration, saveCalibration, setSetting, getSetting, DEFAULT_CALIBRATION } from '../../lib/settings.js';
import { privatePath, fileFor, saveImage, removeUpload } from '../../lib/uploads.js';
import { str, int, formatDate } from '../../lib/util.js';

const router = express.Router();

function certMember(m) {
  return {
    id: m.id,
    member_no: m.member_no,
    salutation: m.salutation || '',
    name: m.name,
    city: m.city || '',
    mandal: m.mandal_name || '',
    category: m.category,
    category_label: CATEGORY_LABEL[m.category] || '',
    designation: m.designation || '',
    serial: m.cert_serial,
    printed: m.cert_print_count,
    printed_at: m.cert_printed_at ? formatDate(m.cert_printed_at, 'short') : '',
  };
}

router.get('/certificates', async (req, res) => {
  const signatures = await db.prepare('SELECT id, label, signer_name, is_default FROM signatures ORDER BY is_default DESC, id').all();
  res.render('admin/certificates', {
    pageTitle: 'प्रमाण पत्र प्रिंटर',
    calibration: await getCalibration(),
    defaults: DEFAULT_CALIBRATION,
    signatures,
    mandals: await db.prepare('SELECT id, name FROM mandals ORDER BY sort_order, id').all(),
    nextSerial: (Number(await getSetting('cert_serial_counter', 0)) || 0) + 1,
    background: await getSetting('cert_background', null),
  });
});

const MAX_BATCH = 1000;

function idList(value) {
  return [...new Set([].concat(value || []).flatMap((v) => String(v).split(',')).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_BATCH);
}

const approvedById = db.prepare("SELECT * FROM members WHERE id = ? AND status = 'approved'");

router.get('/certificates/members', async (req, res) => {
  const filters = {
    status: 'approved',
    category: CATEGORY_KEYS.includes(req.query.category) ? req.query.category : '',
    mandal: int(req.query.mandal) || '',
    committee: int(req.query.committee) || '',
    q: str(req.query.q, 60),
    cert: ['printed', 'unprinted'].includes(req.query.cert) ? req.query.cert : '',
  };
  const ids = idList(req.query.ids);
  if (ids.length) filters.ids = ids;
  const { rows, total } = await listMembers(filters, { limit: MAX_BATCH });
  const counts = await db
    .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN cert_print_count > 0 THEN 1 ELSE 0 END) AS printed FROM members WHERE status = 'approved'")
    .get();
  res.json({
    ok: true,
    items: rows.map(certMember),
    total,
    counts: { total: counts.total, printed: counts.printed || 0, unprinted: counts.total - (counts.printed || 0) },
  });
});

/** Gives members their permanent certificate serial (when serials are printed) before the print dialog opens. */
router.post('/certificates/prepare', async (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) return res.status(422).json({ ok: false, error: 'कोई सदस्य नहीं चुना गया।' });
  const assignSerial = Boolean(req.body?.assignSerial);
  const items = await tx(async () => {
    const out = [];
    for (const id of ids) {
      const m = await approvedById.get(id);
      if (!m) continue;
      let serial = m.cert_serial;
      if (assignSerial && !serial) {
        serial = (Number(await getSetting('cert_serial_counter', 0)) || 0) + 1;
        await setSetting('cert_serial_counter', serial);
        await db.prepare('UPDATE members SET cert_serial = ? WHERE id = ?').run(serial, m.id);
      }
      out.push({ ...certMember(m), serial });
    }
    return out;
  });
  res.json({ ok: true, items, nextSerial: (Number(await getSetting('cert_serial_counter', 0)) || 0) + 1 });
});

/** Records that the certificates came out of the printer. */
router.post('/certificates/issue', async (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) return res.status(422).json({ ok: false, error: 'कोई सदस्य नहीं चुना गया।' });
  res.json({ ok: true, count: await markCertificatesPrinted(ids, req.admin.id) });
});

router.post('/certificates/unmark', async (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) return res.status(422).json({ ok: false, error: 'कोई सदस्य नहीं चुना गया।' });
  res.json({ ok: true, count: await clearCertificatesPrinted(ids) });
});

router.post('/certificates/calibration', async (req, res) => {
  await saveCalibration(req.body?.calibration);
  res.json({ ok: true, calibration: await getCalibration() });
});

router.post('/certificates/calibration/reset', async (req, res) => {
  await setSetting('print_calibration', {});
  res.json({ ok: true, calibration: await getCalibration() });
});

router.post('/certificates/serial', async (req, res) => {
  const next = int(req.body?.next);
  if (!next || next < 1) return res.status(422).json({ ok: false, error: 'मान्य क्रमांक लिखें।' });
  await setSetting('cert_serial_counter', next - 1);
  res.json({ ok: true, nextSerial: next });
});

/** Optional scan of the blank pre-printed sheet, used as the on-screen alignment guide. */
router.post('/certificates/background', async (req, res) => {
  const file = fileFor(req, 'background');
  const current = await getSetting('cert_background', null);
  if (file) {
    await setSetting('cert_background', saveImage(file.buffer));
    removeUpload(current);
  } else if (req.body?.remove) {
    await setSetting('cert_background', null);
    removeUpload(current);
  }
  res.json({ ok: true, background: await getSetting('cert_background', null) });
});

router.get('/certificates/signature/:id', async (req, res, next) => {
  const sig = await db.prepare('SELECT file FROM signatures WHERE id = ?').get(int(req.params.id, 0));
  const file = sig && privatePath(sig.file);
  if (!file) return next();
  res.set('Cache-Control', 'private, max-age=600');
  res.sendFile(file, (err) => err && next());
});

export default router;

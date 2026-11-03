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

router.get('/certificates', (req, res) => {
  const signatures = db.prepare('SELECT id, label, signer_name, is_default FROM signatures ORDER BY is_default DESC, id').all();
  res.render('admin/certificates', {
    pageTitle: 'प्रमाण पत्र प्रिंटर',
    calibration: getCalibration(),
    defaults: DEFAULT_CALIBRATION,
    signatures,
    mandals: db.prepare('SELECT id, name FROM mandals ORDER BY sort_order, id').all(),
    nextSerial: (Number(getSetting('cert_serial_counter', 0)) || 0) + 1,
    background: getSetting('cert_background', null),
  });
});

const MAX_BATCH = 1000;

function idList(value) {
  return [...new Set([].concat(value || []).flatMap((v) => String(v).split(',')).map(Number))]
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_BATCH);
}

const approvedById = db.prepare("SELECT * FROM members WHERE id = ? AND status = 'approved'");

router.get('/certificates/members', (req, res) => {
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
  const { rows, total } = listMembers(filters, { limit: MAX_BATCH });
  const counts = db
    .prepare("SELECT COUNT(*) AS total, SUM(cert_print_count > 0) AS printed FROM members WHERE status = 'approved'")
    .get();
  res.json({
    ok: true,
    items: rows.map(certMember),
    total,
    counts: { total: counts.total, printed: counts.printed || 0, unprinted: counts.total - (counts.printed || 0) },
  });
});

/** Gives members their permanent certificate serial (when serials are printed) before the print dialog opens. */
router.post('/certificates/prepare', (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) return res.status(422).json({ ok: false, error: 'कोई सदस्य नहीं चुना गया।' });
  const assignSerial = Boolean(req.body?.assignSerial);
  const items = tx(() =>
    ids
      .map((id) => approvedById.get(id))
      .filter(Boolean)
      .map((m) => {
        let serial = m.cert_serial;
        if (assignSerial && !serial) {
          serial = (Number(getSetting('cert_serial_counter', 0)) || 0) + 1;
          setSetting('cert_serial_counter', serial);
          db.prepare('UPDATE members SET cert_serial = ? WHERE id = ?').run(serial, m.id);
        }
        return { ...certMember(m), serial };
      })
  );
  res.json({ ok: true, items, nextSerial: (Number(getSetting('cert_serial_counter', 0)) || 0) + 1 });
});

/** Records that the certificates came out of the printer. */
router.post('/certificates/issue', (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) return res.status(422).json({ ok: false, error: 'कोई सदस्य नहीं चुना गया।' });
  res.json({ ok: true, count: markCertificatesPrinted(ids, req.admin.id) });
});

router.post('/certificates/unmark', (req, res) => {
  const ids = idList(req.body?.ids);
  if (!ids.length) return res.status(422).json({ ok: false, error: 'कोई सदस्य नहीं चुना गया।' });
  res.json({ ok: true, count: clearCertificatesPrinted(ids) });
});

router.post('/certificates/calibration', (req, res) => {
  saveCalibration(req.body?.calibration);
  res.json({ ok: true, calibration: getCalibration() });
});

router.post('/certificates/calibration/reset', (req, res) => {
  setSetting('print_calibration', {});
  res.json({ ok: true, calibration: getCalibration() });
});

router.post('/certificates/serial', (req, res) => {
  const next = int(req.body?.next);
  if (!next || next < 1) return res.status(422).json({ ok: false, error: 'मान्य क्रमांक लिखें।' });
  setSetting('cert_serial_counter', next - 1);
  res.json({ ok: true, nextSerial: next });
});

/** Optional scan of the blank pre-printed sheet, used as the on-screen alignment guide. */
router.post('/certificates/background', (req, res) => {
  const file = fileFor(req, 'background');
  const current = getSetting('cert_background', null);
  if (file) {
    setSetting('cert_background', saveImage(file.buffer));
    removeUpload(current);
  } else if (req.body?.remove) {
    setSetting('cert_background', null);
    removeUpload(current);
  }
  res.json({ ok: true, background: getSetting('cert_background', null) });
});

router.get('/certificates/signature/:id', (req, res, next) => {
  const sig = db.prepare('SELECT file FROM signatures WHERE id = ?').get(int(req.params.id, 0));
  const file = sig && privatePath(sig.file);
  if (!file) return next();
  res.set('Cache-Control', 'private, max-age=600');
  res.sendFile(file, (err) => err && next());
});

export default router;

import express from 'express';
import bcrypt from 'bcryptjs';
import { db, tx } from '../../db.js';
import { flash, requireSuper } from '../../middleware/auth.js';
import { fileFor, saveImage, saveDataUrlImage, removeUpload, UploadError } from '../../lib/uploads.js';
import { str, int } from '../../lib/util.js';

const router = express.Router();

/* ---------- Authorised signatures (अध्यक्ष / सचिव) ---------- */

router.get('/signatures', (req, res) => {
  const signatures = db.prepare('SELECT * FROM signatures ORDER BY is_default DESC, id').all();
  res.render('admin/signatures', { pageTitle: 'अधिकृत हस्ताक्षर', signatures });
});

router.post('/signatures', (req, res) => {
  const body = req.body ?? {};
  const label = str(body.label, 60);
  if (!label) {
    flash(req, 'error', 'पद (जैसे अध्यक्ष / सचिव) लिखना आवश्यक है।');
    return res.redirect('/admin/signatures');
  }
  let file;
  try {
    const upload = fileFor(req, 'file');
    if (upload) file = saveImage(upload.buffer, { isPrivate: true });
    else if (body.drawn) file = saveDataUrlImage(body.drawn, { isPrivate: true });
  } catch (err) {
    if (!(err instanceof UploadError)) throw err;
    flash(req, 'error', err.message);
    return res.redirect('/admin/signatures');
  }
  if (!file) {
    flash(req, 'error', 'कृपया हस्ताक्षर की फ़ोटो अपलोड करें या बॉक्स में हस्ताक्षर करें।');
    return res.redirect('/admin/signatures');
  }
  tx(() => {
    const isFirst = db.prepare('SELECT COUNT(*) AS n FROM signatures').get().n === 0;
    db.prepare('INSERT INTO signatures (label, signer_name, file, is_default) VALUES (?, ?, ?, ?)').run(
      label,
      str(body.signer_name, 80) || null,
      file,
      isFirst ? 1 : 0
    );
  });
  flash(req, 'success', 'हस्ताक्षर सहेजा गया।');
  res.redirect('/admin/signatures');
});

router.post('/signatures/:id/default', (req, res) => {
  tx(() => {
    db.prepare('UPDATE signatures SET is_default = 0').run();
    db.prepare('UPDATE signatures SET is_default = 1 WHERE id = ?').run(int(req.params.id, 0));
  });
  flash(req, 'success', 'डिफ़ॉल्ट हस्ताक्षर बदला गया।');
  res.redirect('/admin/signatures');
});

router.post('/signatures/:id/delete', (req, res) => {
  const sig = db.prepare('SELECT * FROM signatures WHERE id = ?').get(int(req.params.id, 0));
  if (sig) {
    db.prepare('DELETE FROM signatures WHERE id = ?').run(sig.id);
    removeUpload(sig.file);
    flash(req, 'success', 'हस्ताक्षर हटाया गया।');
  }
  res.redirect('/admin/signatures');
});

/* ---------- Admin users ---------- */

router.get('/users', requireSuper, (req, res) => {
  const users = db.prepare('SELECT id, username, name, role, created_at, last_login_at FROM admins ORDER BY id').all();
  res.render('admin/users', { pageTitle: 'एडमिन उपयोगकर्ता', users });
});

router.post('/users', requireSuper, (req, res) => {
  const body = req.body ?? {};
  const username = str(body.username, 40).toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-z0-9_.-]{3,40}$/.test(username)) {
    flash(req, 'error', 'उपयोगकर्ता नाम में केवल अंग्रेज़ी अक्षर, अंक, _ . - (कम से कम 3) हों।');
  } else if (password.length < 8) {
    flash(req, 'error', 'पासवर्ड कम से कम 8 अक्षरों का हो।');
  } else if (db.prepare('SELECT 1 FROM admins WHERE username = ?').get(username)) {
    flash(req, 'error', 'यह उपयोगकर्ता नाम पहले से मौजूद है।');
  } else {
    db.prepare('INSERT INTO admins (username, name, password_hash, role, must_change_password) VALUES (?, ?, ?, ?, 1)').run(
      username,
      str(body.name, 80) || username,
      bcrypt.hashSync(password, 10),
      body.role === 'superadmin' ? 'superadmin' : 'subadmin'
    );
    flash(req, 'success', 'नया एडमिन बनाया गया। पहले लॉगिन पर उन्हें पासवर्ड बदलना होगा।');
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/delete', requireSuper, (req, res) => {
  const id = int(req.params.id, 0);
  if (id === req.admin.id) {
    flash(req, 'error', 'आप स्वयं को नहीं हटा सकते।');
  } else {
    db.prepare('DELETE FROM admins WHERE id = ?').run(id);
    flash(req, 'success', 'एडमिन हटाया गया।');
  }
  res.redirect('/admin/users');
});

router.post('/users/:id/reset', requireSuper, (req, res) => {
  const password = String(req.body?.password || '');
  if (password.length < 8) {
    flash(req, 'error', 'नया पासवर्ड कम से कम 8 अक्षरों का हो।');
  } else {
    db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(
      bcrypt.hashSync(password, 10),
      int(req.params.id, 0)
    );
    flash(req, 'success', 'पासवर्ड रीसेट किया गया।');
  }
  res.redirect('/admin/users');
});

/* ---------- Own password ---------- */

router.get('/password', (req, res) => {
  res.render('admin/password', { pageTitle: 'पासवर्ड बदलें', error: null });
});

router.post('/password', (req, res) => {
  const body = req.body ?? {};
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  const next = String(body.new_password || '');
  let error = null;
  if (!bcrypt.compareSync(String(body.current_password || ''), admin.password_hash)) error = 'वर्तमान पासवर्ड गलत है।';
  else if (next.length < 8) error = 'नया पासवर्ड कम से कम 8 अक्षरों का हो।';
  else if (next !== body.confirm_password) error = 'दोनों नए पासवर्ड मेल नहीं खाते।';
  else if (bcrypt.compareSync(next, admin.password_hash)) error = 'नया पासवर्ड पुराने से अलग होना चाहिए।';
  if (error) return res.status(422).render('admin/password', { pageTitle: 'पासवर्ड बदलें', error });
  db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(bcrypt.hashSync(next, 10), admin.id);
  flash(req, 'success', 'पासवर्ड सफलतापूर्वक बदला गया।');
  res.redirect('/admin');
});

export default router;

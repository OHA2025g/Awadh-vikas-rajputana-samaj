import express from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { db } from '../../db.js';
import { requireAdmin, ensureCsrfToken, verifyCsrf, consumeFlash } from '../../middleware/auth.js';
import { adminUpload } from '../../lib/uploads.js';
import { categoryCounts } from '../../lib/members.js';
import { gatewayStatus } from '../../lib/whatsapp.js';
import { todayISO } from '../../lib/util.js';
import membersRouter from './members.js';
import certificatesRouter from './certificates.js';
import whatsappRouter from './whatsapp.js';
import contentRouter from './content.js';
import wallRouter from './wall.js';
import systemRouter from './system.js';
import donationsRouter from './donations.js';
import meetingsRouter from './meetings.js';

const router = express.Router();

router.use(ensureCsrfToken, consumeFlash, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.locals.adminPath = req.path;
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) =>
    res.status(429).render('admin/login', { error: 'बहुत अधिक असफल प्रयास। 15 मिनट बाद पुनः प्रयास करें।', next: '', username: '' }),
});

function safeNext(value) {
  const s = String(value || '');
  return s.startsWith('/admin') && !s.startsWith('//') ? s : '/admin';
}

router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  res.render('admin/login', { error: null, next: safeNext(req.query.next), username: '' });
});

router.post('/login', loginLimiter, verifyCsrf, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).render('admin/login', { error: 'उपयोगकर्ता नाम या पासवर्ड गलत है।', next: safeNext(req.body?.next), username });
  }
  db.prepare('UPDATE admins SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(admin.id);
  req.session.adminId = admin.id;
  res.redirect(admin.must_change_password ? '/admin/password' : safeNext(req.body?.next));
});

router.post('/logout', verifyCsrf, (req, res) => {
  req.session = null;
  res.redirect('/admin/login');
});

router.use(requireAdmin, adminUpload.any(), verifyCsrf, (req, res, next) => {
  res.locals.badges = {
    applications: db.prepare("SELECT COUNT(*) AS n FROM members WHERE status = 'pending'").get().n,
    wall: db.prepare("SELECT COUNT(*) AS n FROM posts WHERE status = 'pending'").get().n,
  };
  next();
});

router.get('/', (req, res) => {
  const counts = categoryCounts({ publicOnly: false, status: 'approved' });
  const recent = db
    .prepare(
      `SELECT m.id, m.name, m.salutation, m.application_no, m.city, m.photo, m.created_at, md.name AS mandal_name
       FROM members m LEFT JOIN mandals md ON md.id = m.mandal_id
       WHERE m.status = 'pending' ORDER BY m.created_at DESC LIMIT 6`
    )
    .all();
  const broadcasts = db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 4').all();
  const upcoming = db
    .prepare('SELECT id, title, event_date, location FROM events WHERE event_date >= ? ORDER BY event_date LIMIT 3')
    .all(todayISO());
  const certsIssued = db.prepare('SELECT COUNT(*) AS n FROM members WHERE cert_print_count > 0').get().n;
  res.render('admin/dashboard', {
    pageTitle: 'डैशबोर्ड',
    counts,
    recent,
    broadcasts,
    upcoming,
    certsIssued,
    gateway: gatewayStatus(),
  });
});

router.use(membersRouter);
router.use(certificatesRouter);
router.use(whatsappRouter);
router.use(contentRouter);
router.use(wallRouter);
router.use(donationsRouter);
router.use(meetingsRouter);
router.use(systemRouter);

export default router;

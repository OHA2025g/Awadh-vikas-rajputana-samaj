import crypto from 'node:crypto';
import { db } from '../db.js';

const findAdmin = db.prepare('SELECT id, username, name, role, must_change_password FROM admins WHERE id = ?');

export async function loadAdmin(req, res, next) {
  const id = req.session?.adminId;
  const admin = id ? await findAdmin.get(id) : null;
  if (id && !admin) req.session.adminId = null;
  req.admin = admin || null;
  res.locals.admin = req.admin;
  res.locals.isSuper = req.admin?.role === 'superadmin';
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.admin) {
    if (req.accepts(['html', 'json']) === 'json' || req.xhr) {
      return res.status(401).json({ ok: false, error: 'कृपया पुनः लॉगिन करें।' });
    }
    return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  if (req.admin.must_change_password && !req.path.startsWith('/password') && req.path !== '/logout') {
    return res.redirect('/admin/password');
  }
  next();
}

export function requireSuper(req, res, next) {
  if (req.admin?.role === 'superadmin') return next();
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(403).json({ ok: false, error: 'यह कार्य केवल मुख्य एडमिन कर सकते हैं।' });
  }
  flash(req, 'error', 'यह कार्य केवल मुख्य एडमिन कर सकते हैं।');
  return res.redirect('/admin');
}

export function ensureCsrfToken(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrfToken = req.session.csrf;
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function verifyCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.body?._csrf || req.get('x-csrf-token') || '';
  const expected = req.session?.csrf || '';
  const ok =
    sent.length === expected.length &&
    expected.length > 0 &&
    crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
  if (ok) return next();
  if (req.accepts(['html', 'json']) === 'json') {
    return res.status(403).json({ ok: false, error: 'सुरक्षा टोकन अमान्य है, पेज रीफ़्रेश करें।' });
  }
  return res.status(403).send('सुरक्षा टोकन अमान्य है। कृपया पेज रीफ़्रेश करके पुनः प्रयास करें।');
}

export function flash(req, type, msg) {
  req.session.flash = { type, msg };
}

export function consumeFlash(req, res, next) {
  res.locals.flash = req.session?.flash || null;
  if (req.session?.flash) req.session.flash = null;
  next();
}

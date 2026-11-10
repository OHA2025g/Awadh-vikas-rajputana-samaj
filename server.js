import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import { ROOT, UPLOAD_DIR, PORT, IS_PROD } from './src/config.js';
import { seedIfEmpty } from './src/seed.js';
import { getSessionSecret } from './src/lib/settings.js';
import { viewHelpers } from './src/middleware/locals.js';
import { loadAdmin } from './src/middleware/auth.js';
import { UploadError } from './src/lib/uploads.js';
import { autoStartWhatsApp } from './src/lib/whatsapp.js';
import { pauseInterruptedBroadcasts } from './src/lib/broadcast.js';
import { syncMandals } from './src/lib/mandals.js';
import publicRoutes from './src/routes/public.js';
import apiRoutes from './src/routes/api.js';
import adminRoutes from './src/routes/admin/index.js';

await seedIfEmpty();
await pauseInterruptedBroadcasts();
await syncMandals();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        frameSrc: ['https://www.google.com', 'https://maps.google.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: IS_PROD ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cookieSession({
    name: 'arvs_sess',
    keys: [await getSessionSecret()],
    maxAge: 12 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === 'true',
  })
);

app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', fallthrough: false }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: IS_PROD ? '1d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(viewHelpers);
app.use(loadAdmin);

app.use('/api', apiRoutes);
app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

/** Static-file errors reach the handlers below before the view locals are populated. */
async function ensureViewLocals(req, res) {
  if (res.locals.site) return;
  await viewHelpers(req, res, () => {});
  await loadAdmin(req, res, () => {});
}

app.use(async (req, res) => {
  await ensureViewLocals(req, res);
  res.status(404).render('public/error', { pageTitle: 'पृष्ठ नहीं मिला', code: 404, message: 'आप जिस पृष्ठ को खोज रहे हैं, वह उपलब्ध नहीं है।' });
});

app.use(async (err, req, res, _next) => {
  await ensureViewLocals(req, res);
  const isUpload = err instanceof UploadError || err?.name === 'MulterError';
  const status = isUpload ? 400 : err.status || err.statusCode || 500;
  const message = isUpload
    ? err.code === 'LIMIT_FILE_SIZE'
      ? 'फ़ाइल का आकार बहुत बड़ा है।'
      : err instanceof UploadError
        ? err.message
        : 'फ़ॉर्म में बहुत अधिक या बहुत बड़ी जानकारी भेजी गई। कृपया जाँचकर पुनः प्रयास करें।'
    : status === 404
      ? 'फ़ाइल या पृष्ठ उपलब्ध नहीं है।'
      : status >= 500
        ? 'सर्वर में कोई त्रुटि हुई। कृपया कुछ देर बाद प्रयास करें।'
        : err.message;
  if (status >= 500) console.error(err);
  if (req.accepts(['html', 'json']) === 'json') return res.status(status).json({ ok: false, error: message });
  res.status(status).render('public/error', { pageTitle: 'त्रुटि', code: status, message });
});

app.listen(PORT, (err) => {
  if (err) {
    console.error(
      err.code === 'EADDRINUSE'
        ? `पोर्ट ${PORT} पहले से उपयोग में है। चल रहे सर्वर को बंद करें या .env में PORT बदलें।`
        : `सर्वर शुरू नहीं हो सका: ${err.message}`,
    );
    process.exit(1);
  }
  console.log(`अवध राजपूत विकास संघ वेबसाइट: http://localhost:${PORT}`);
  autoStartWhatsApp().catch((err) => console.error('[whatsapp]', err.message));
});

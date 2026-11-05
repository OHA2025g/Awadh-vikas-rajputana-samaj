import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { POST_CATEGORIES, DONATION_CATEGORIES, PAYMENT_MODE_LABEL } from '../config.js';
import { categoryCounts, findActiveByPhone, nextApplicationNo, toPublicMember, listMembers } from '../lib/members.js';
import { donationFilters, donationTotals, listDonations } from '../lib/donations.js';
import { parseFormFields } from '../lib/membership-form.js';
import { publicUpload, saveImage, saveDataUrlImage, UploadError } from '../lib/uploads.js';
import { str, text, int, normalizePhone, todayISO, paginate, formatDate, formatINR, maskReference } from '../lib/util.js';

const router = express.Router();

const limiter = (limit, minutes, message) =>
  rateLimit({
    windowMs: minutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ ok: false, error: message }),
  });

const joinLimiter = limiter(8, 15, 'बहुत अधिक प्रयास हुए। कृपया 15 मिनट बाद पुनः प्रयास करें।');
const postLimiter = limiter(6, 15, 'बहुत अधिक पोस्ट भेजी गईं। कृपया कुछ देर बाद प्रयास करें।');
const statusLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

const mandalsStmt = db.prepare('SELECT * FROM mandals ORDER BY sort_order, id');
const committeesStmt = db.prepare('SELECT * FROM committees ORDER BY sort_order, id');

function visitorId(req) {
  if (!req.session.vid) req.session.vid = crypto.randomBytes(12).toString('hex');
  return req.session.vid;
}

/* ---------- Home ---------- */

router.get('/', async (req, res) => {
  const today = todayISO();
  const sections = await db.prepare('SELECT * FROM sections WHERE visible = 1 AND show_on_home = 1 ORDER BY sort_order, id').all();
  const people = await db.prepare('SELECT * FROM people WHERE visible = 1 ORDER BY sort_order, id').all();
  const programs = await db.prepare('SELECT * FROM programs WHERE visible = 1 ORDER BY sort_order, id').all();
  const upcoming = await db
    .prepare('SELECT * FROM events WHERE visible = 1 AND event_date >= ? ORDER BY event_date ASC LIMIT 3')
    .all(today);
  const past = await db
    .prepare('SELECT * FROM events WHERE visible = 1 AND (event_date < ? OR event_date IS NULL) ORDER BY event_date DESC LIMIT 3')
    .all(today);
  const posts = await db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id AND c.status = 'published') AS comment_count
       FROM posts p WHERE p.status = 'published' ORDER BY p.pinned DESC, p.created_at DESC LIMIT 3`
    )
    .all();
  const counts = await categoryCounts({ publicOnly: true });
  const featured = (await listMembers({ publicOnly: true, category: 'pramukh' }, { limit: 4 })).rows.map(toPublicMember);
  const stats = {
    members: counts.all,
    mandals: (await db.prepare('SELECT COUNT(*) AS n FROM mandals').get()).n,
    committees: (await db.prepare('SELECT COUNT(*) AS n FROM committees').get()).n,
    events: (await db.prepare('SELECT COUNT(*) AS n FROM events WHERE visible = 1').get()).n,
  };
  res.render('public/home', {
    sections,
    people,
    programs,
    upcoming,
    past,
    posts,
    counts,
    featured,
    stats,
    mandals: await mandalsStmt.all(),
  });
});

/* ---------- Directory ---------- */

router.get('/directory', async (req, res) => {
  res.render('public/directory', {
    pageTitle: 'सदस्य निर्देशिका',
    mandals: await mandalsStmt.all(),
    committees: await committeesStmt.all(),
    counts: await categoryCounts({ publicOnly: true }),
    initialCategory: ['pramukh', 'padadhikari', 'sadasya'].includes(req.query.category) ? req.query.category : '',
  });
});

/* ---------- Donations (public ledger) ---------- */

const DONATIONS_PER_PAGE = 50;

function toPublicDonation(d) {
  return {
    name: d.anonymous ? 'गुप्त सहयोग' : d.name,
    anonymous: Boolean(d.anonymous),
    amount: formatINR(d.amount_paise),
    mode: PAYMENT_MODE_LABEL[d.payment_mode] || '',
    date: formatDate(d.paid_on, 'short'),
    details: d.details || '',
    reference: maskReference(d.reference),
  };
}

router.get('/donations', async (req, res) => {
  const filters = donationFilters({ category: req.query.category, q: req.query.q });
  filters.category ||= DONATION_CATEGORIES[0].key;
  const totals = await donationTotals({ q: filters.q }, { isPublic: true });
  const pg = paginate(totals[filters.category].n, int(req.query.page), DONATIONS_PER_PAGE);
  const { rows } = await listDonations(filters, { limit: DONATIONS_PER_PAGE, offset: pg.offset, isPublic: true });
  res.render('public/donations', {
    pageTitle: 'सहयोग',
    filters,
    totals,
    pg,
    rows: rows.map(toPublicDonation),
  });
});

/* ---------- Membership application ---------- */

router.get('/join', async (req, res) => {
  res.render('public/join', {
    pageTitle: 'सदस्यता फॉर्म',
    extraStyles: ['/css/membership-form.css'],
    today: formatDate(new Date(), 'numeric'),
  });
});

function validateApplication(body) {
  const { v, errors } = parseFormFields(body, { strict: true });
  v.phone = normalizePhone(body.phone);
  v.whatsapp = v.phone || null;
  if (!v.phone) errors.phone = 'कृपया 10 अंकों का मान्य मोबाइल नंबर लिखें।';
  if (!body.signature || !String(body.signature).startsWith('data:image/')) errors.signature = 'कृपया हस्ताक्षर करें।';
  if (!body.declaration) errors.declaration = 'कृपया घोषणा स्वीकार करें।';
  return { v, errors };
}

router.post('/join', joinLimiter, publicUpload.single('photo'), async (req, res) => {
  const body = req.body ?? {};
  if (body.website) return res.json({ ok: true, application_no: '—' });

  const { v, errors } = validateApplication(body);
  if (!errors.phone && v.phone) {
    const existing = await findActiveByPhone(v.phone);
    if (existing) {
      errors.phone =
        existing.status === 'approved'
          ? 'इस मोबाइल नंबर से सदस्यता पहले से स्वीकृत है।'
          : `इस मोबाइल नंबर से आवेदन (${existing.application_no}) पहले से लंबित है।`;
    }
  }
  if (Object.keys(errors).length) return res.status(422).json({ ok: false, errors });

  let photo = null;
  let signature = null;
  try {
    if (req.file) photo = saveImage(req.file.buffer);
    signature = saveDataUrlImage(body.signature, { isPrivate: true });
  } catch (err) {
    if (err instanceof UploadError) return res.status(422).json({ ok: false, errors: { photo: err.message } });
    throw err;
  }

  const row = { ...v, photo, signature };
  const cols = Object.keys(row);
  const info = await db
    .prepare(
      `INSERT INTO members (status, category, ${cols.join(', ')}) VALUES ('pending', 'sadasya', ${cols.map((c) => `@${c}`).join(', ')})`
    )
    .run(row);
  const applicationNo = nextApplicationNo(info.lastInsertRowid);
  await db.prepare('UPDATE members SET application_no = ? WHERE id = ?').run(applicationNo, info.lastInsertRowid);
  res.json({ ok: true, application_no: applicationNo, name: v.name });
});

/* ---------- Application status ---------- */

router.get('/status', async (req, res) => {
  res.render('public/status', { pageTitle: 'आवेदन की स्थिति', result: null, query: {} });
});

router.post('/status', statusLimiter, async (req, res) => {
  const appNo = str(req.body?.application_no, 20).toUpperCase();
  const phone = normalizePhone(req.body?.phone);
  const m =
    appNo && phone
      ? await db
          .prepare('SELECT name, status, member_no, application_no, reject_reason, created_at FROM members WHERE application_no = ? AND phone = ?')
          .get(appNo, phone)
      : null;
  res.render('public/status', {
    pageTitle: 'आवेदन की स्थिति',
    result: m || 'notfound',
    query: { application_no: appNo, phone: req.body?.phone || '' },
  });
});

/* ---------- Community wall ---------- */

router.get('/wall', async (req, res) => {
  const cat = POST_CATEGORIES.some((c) => c.key === req.query.cat) ? req.query.cat : '';
  const where = `p.status = 'published'${cat ? ' AND p.category = @cat' : ''}`;
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`).get({ cat })).n;
  const pg = paginate(total, int(req.query.page, 1), 10);
  const posts = await db
    .prepare(
      `SELECT p.*, m.photo AS member_photo FROM posts p LEFT JOIN members m ON m.id = p.member_id
       WHERE ${where} ORDER BY p.pinned DESC, p.created_at DESC LIMIT @limit OFFSET @offset`
    )
    .all({ cat, limit: pg.perPage, offset: pg.offset });

  const ids = posts.map((p) => p.id);
  const comments = ids.length
    ? await db
        .prepare(
          `SELECT * FROM comments WHERE status = 'published' AND post_id IN (${ids.join(',')}) ORDER BY created_at ASC`
        )
        .all()
    : [];
  const vid = req.session.vid;
  const liked = new Set(
    vid && ids.length
      ? (await db
          .prepare(`SELECT post_id FROM post_likes WHERE visitor = ? AND post_id IN (${ids.join(',')})`)
          .all(vid))
          .map((r) => r.post_id)
      : []
  );
  for (const p of posts) {
    p.comments = comments.filter((c) => c.post_id === p.id);
    p.liked = liked.has(p.id);
  }
  res.render('public/wall', { pageTitle: 'सामुदायिक मंच', posts, cat, pg });
});

router.post('/wall/post', postLimiter, publicUpload.single('image'), async (req, res) => {
  const body = req.body ?? {};
  const memberNo = str(body.member_no, 20).toUpperCase();
  const phone = normalizePhone(body.phone);
  const member = await db
    .prepare("SELECT id, name, salutation FROM members WHERE status = 'approved' AND member_no = ? AND phone = ?")
    .get(memberNo, phone);
  if (!member) {
    return res.status(422).json({ ok: false, error: 'सदस्य क्रमांक और मोबाइल नंबर का मिलान नहीं हुआ।' });
  }
  const allowed = POST_CATEGORIES.filter((c) => c.key !== 'announcement').map((c) => c.key);
  const category = allowed.includes(body.category) ? body.category : 'general';
  const postBody = text(body.body, 3000);
  if (postBody.length < 5) return res.status(422).json({ ok: false, error: 'कृपया पोस्ट का विवरण लिखें।' });

  let image = null;
  try {
    if (req.file) image = saveImage(req.file.buffer);
  } catch (err) {
    if (err instanceof UploadError) return res.status(422).json({ ok: false, error: err.message });
    throw err;
  }
  visitorId(req);
  await db.prepare(
    "INSERT INTO posts (category, title, body, image, author_name, member_id, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
  ).run(category, str(body.title, 120) || null, postBody, image, member.name, member.id);
  res.json({ ok: true, message: 'आपकी पोस्ट समीक्षा हेतु भेज दी गई है। स्वीकृति के बाद यह मंच पर दिखाई देगी।' });
});

/* ---------- Events ---------- */

router.get('/events', async (req, res) => {
  const today = todayISO();
  const upcoming = await db
    .prepare('SELECT * FROM events WHERE visible = 1 AND event_date >= ? ORDER BY event_date ASC')
    .all(today);
  const past = await db
    .prepare('SELECT * FROM events WHERE visible = 1 AND (event_date < ? OR event_date IS NULL) ORDER BY event_date DESC')
    .all(today);
  res.render('public/events', { pageTitle: 'गतिविधियाँ एवं आयोजन', upcoming, past });
});

router.get('/events/:id', async (req, res, next) => {
  const event = await db.prepare('SELECT * FROM events WHERE id = ? AND visible = 1').get(int(req.params.id, 0));
  if (!event) return next();
  let gallery = [];
  try {
    gallery = JSON.parse(event.gallery || '[]');
  } catch {
    gallery = [];
  }
  res.render('public/event', { pageTitle: event.title, event, gallery, isUpcoming: event.event_date >= todayISO() });
});

/* ---------- Custom pages ---------- */

router.get('/page/:slug', async (req, res, next) => {
  const section = await db
    .prepare("SELECT * FROM sections WHERE slug = ? AND has_page = 1 AND visible = 1 AND kind = 'custom'")
    .get(String(req.params.slug));
  if (!section) return next();
  res.render('public/page', { pageTitle: section.title, section });
});

export default router;

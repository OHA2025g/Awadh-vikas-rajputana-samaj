import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { db, tx } from '../db.js';
import { CATEGORY_KEYS } from '../config.js';
import { listMembers, toPublicMember, categoryCounts } from '../lib/members.js';
import { str, text, int, paginate, relativeTime } from '../lib/util.js';

const router = express.Router();

const commentLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ ok: false, error: 'बहुत अधिक टिप्पणियाँ। कृपया कुछ देर बाद प्रयास करें।' }),
});
const likeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/directory', (req, res) => {
  const filters = {
    publicOnly: true,
    category: CATEGORY_KEYS.includes(req.query.category) ? req.query.category : '',
    mandal: int(req.query.mandal) || '',
    committee: int(req.query.committee) || '',
    q: str(req.query.q, 60),
  };
  const perPage = 24;
  const { total } = listMembers(filters, { limit: 0 });
  const pg = paginate(total, int(req.query.page, 1), perPage);
  const { rows } = listMembers(filters, { limit: pg.perPage, offset: pg.offset });
  const counts = categoryCounts({ publicOnly: true });
  res.json({ ok: true, items: rows.map(toPublicMember), total, page: pg.page, pages: pg.pages, counts });
});

const postExists = db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'");

router.post('/wall/:id/like', likeLimiter, (req, res) => {
  const post = postExists.get(int(req.params.id, 0));
  if (!post) return res.status(404).json({ ok: false, error: 'पोस्ट नहीं मिली।' });
  if (!req.session.vid) req.session.vid = crypto.randomBytes(12).toString('hex');
  const vid = req.session.vid;

  const result = tx(() => {
    const had = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND visitor = ?').get(post.id, vid);
    if (had) {
      db.prepare('DELETE FROM post_likes WHERE post_id = ? AND visitor = ?').run(post.id, vid);
      db.prepare('UPDATE posts SET likes = MAX(0, likes - 1) WHERE id = ?').run(post.id);
    } else {
      db.prepare('INSERT INTO post_likes (post_id, visitor) VALUES (?, ?)').run(post.id, vid);
      db.prepare('UPDATE posts SET likes = likes + 1 WHERE id = ?').run(post.id);
    }
    return { liked: !had, likes: db.prepare('SELECT likes FROM posts WHERE id = ?').get(post.id).likes };
  });
  res.json({ ok: true, ...result });
});

router.post('/wall/:id/comments', commentLimiter, (req, res) => {
  const post = postExists.get(int(req.params.id, 0));
  if (!post) return res.status(404).json({ ok: false, error: 'पोस्ट नहीं मिली।' });
  if (req.body?.website) return res.json({ ok: true });
  const name = str(req.body?.name, 60);
  const body = text(req.body?.body, 1000);
  if (name.length < 2) return res.status(422).json({ ok: false, error: 'कृपया अपना नाम लिखें।' });
  if (body.length < 2) return res.status(422).json({ ok: false, error: 'कृपया टिप्पणी लिखें।' });
  const info = db.prepare('INSERT INTO comments (post_id, name, body) VALUES (?, ?, ?)').run(post.id, name, body);
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, comment: { id: c.id, name: c.name, body: c.body, when: relativeTime(c.created_at) } });
});

export default router;

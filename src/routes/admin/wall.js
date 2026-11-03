import express from 'express';
import { db } from '../../db.js';
import { POST_CATEGORIES } from '../../config.js';
import { flash } from '../../middleware/auth.js';
import { fileFor, saveImage, removeUpload } from '../../lib/uploads.js';
import { str, text, int, bool, paginate } from '../../lib/util.js';

const router = express.Router();

router.get('/wall', (req, res) => {
  const status = ['pending', 'published', 'rejected'].includes(req.query.status) ? req.query.status : 'published';
  const total = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE status = ?').get(status).n;
  const pg = paginate(total, int(req.query.page, 1), 20);
  const posts = db
    .prepare(
      `SELECT p.*, m.member_no, (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count
       FROM posts p LEFT JOIN members m ON m.id = p.member_id
       WHERE p.status = ? ORDER BY p.pinned DESC, p.created_at DESC LIMIT ? OFFSET ?`
    )
    .all(status, pg.perPage, pg.offset);
  const comments = db
    .prepare(
      `SELECT c.*, p.title AS post_title, p.body AS post_body FROM comments c JOIN posts p ON p.id = c.post_id
       ORDER BY c.created_at DESC LIMIT 30`
    )
    .all();
  res.render('admin/wall', { pageTitle: 'सामुदायिक मंच', posts, comments, status, pg, editing: null });
});

router.get('/wall/:id/edit', (req, res, next) => {
  const editing = db.prepare('SELECT * FROM posts WHERE id = ?').get(int(req.params.id, 0));
  if (!editing) return next();
  res.render('admin/wall', { pageTitle: 'पोस्ट संपादन', posts: [], comments: [], status: editing.status, pg: null, editing });
});

function parsePost(body) {
  return {
    category: POST_CATEGORIES.some((c) => c.key === body.category) ? body.category : 'announcement',
    title: str(body.title, 150) || null,
    body: text(body.body, 5000),
    author_name: str(body.author_name, 80) || null,
    pinned: bool(body.pinned),
  };
}

router.post('/wall', (req, res) => {
  const v = parsePost(req.body ?? {});
  if (v.body.length < 2) {
    flash(req, 'error', 'पोस्ट का विवरण आवश्यक है।');
    return res.redirect('/admin/wall');
  }
  const file = fileFor(req, 'image');
  const image = file ? saveImage(file.buffer) : null;
  db.prepare(
    "INSERT INTO posts (category, title, body, image, author_name, admin_id, pinned, status) VALUES (@category, @title, @body, @image, @author_name, @admin_id, @pinned, 'published')"
  ).run({ ...v, image, author_name: v.author_name || 'संघ कार्यालय', admin_id: req.admin.id });
  flash(req, 'success', 'पोस्ट प्रकाशित की गई।');
  res.redirect('/admin/wall');
});

router.post('/wall/comments/:id/delete', (req, res) => {
  db.prepare('DELETE FROM comments WHERE id = ?').run(int(req.params.id, 0));
  flash(req, 'success', 'टिप्पणी हटाई गई।');
  res.redirect('/admin/wall');
});

router.post('/wall/:id', (req, res, next) => {
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(int(req.params.id, 0));
  if (!existing) return next();
  const v = parsePost(req.body ?? {});
  let image = existing.image;
  const file = fileFor(req, 'image');
  if (file) {
    image = saveImage(file.buffer);
    removeUpload(existing.image);
  } else if (req.body?.remove_image) {
    removeUpload(existing.image);
    image = null;
  }
  db.prepare(
    'UPDATE posts SET category = @category, title = @title, body = @body, author_name = @author_name, pinned = @pinned, image = @image WHERE id = @id'
  ).run({ ...v, author_name: v.author_name || existing.author_name, image, id: existing.id });
  flash(req, 'success', 'पोस्ट अपडेट की गई।');
  res.redirect(`/admin/wall?status=${existing.status}`);
});

router.post('/wall/:id/:action', (req, res) => {
  const id = int(req.params.id, 0);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) return res.redirect('/admin/wall');
  switch (req.params.action) {
    case 'approve':
      db.prepare("UPDATE posts SET status = 'published', created_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      flash(req, 'success', 'पोस्ट प्रकाशित की गई।');
      break;
    case 'reject':
      db.prepare("UPDATE posts SET status = 'rejected' WHERE id = ?").run(id);
      flash(req, 'success', 'पोस्ट अस्वीकृत की गई।');
      break;
    case 'pin':
      db.prepare('UPDATE posts SET pinned = 1 - pinned WHERE id = ?').run(id);
      break;
    case 'delete':
      db.prepare('DELETE FROM posts WHERE id = ?').run(id);
      removeUpload(post.image);
      flash(req, 'success', 'पोस्ट हटाई गई।');
      break;
    default:
      flash(req, 'error', 'अमान्य कार्य।');
  }
  res.redirect(`/admin/wall?status=${post.status === 'pending' ? 'pending' : post.status}`);
});

export default router;

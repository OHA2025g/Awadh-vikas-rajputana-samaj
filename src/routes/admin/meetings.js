import express from 'express';
import { db, tx } from '../../db.js';
import { flash, requireSuper } from '../../middleware/auth.js';
import { cleanHtml } from '../../lib/sanitize.js';
import { filesFor, saveDocument, removeUpload, privatePath } from '../../lib/uploads.js';
import { likeTerm } from '../../lib/members.js';
import { str, int, paginate, isISODate } from '../../lib/util.js';

const router = express.Router();
const PER_PAGE = 24;
const MAX_ATTENDEES = 300;

const committees = () => db.prepare('SELECT id, name FROM committees ORDER BY sort_order, id').all();
const memberLabel = (m) => [m.salutation, m.name].filter(Boolean).join(' ');

function parseAttendees(raw) {
  try {
    const list = JSON.parse(raw || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function meetingFilters(query) {
  return {
    q: str(query.q, 80),
    committee: int(query.committee) || '',
    year: /^\d{4}$/.test(query.year) ? query.year : '',
    view: query.view === 'list' ? 'list' : 'gallery',
  };
}

function buildWhere({ q, committee, year }) {
  const where = [];
  const params = {};
  if (q) {
    where.push(
      `(mt.title LIKE @q ESCAPE '\\' OR mt.venue LIKE @q ESCAPE '\\' OR mt.minutes LIKE @q ESCAPE '\\' OR mt.attendees LIKE @q ESCAPE '\\' OR c.name LIKE @q ESCAPE '\\')`
    );
    params.q = likeTerm(q);
  }
  if (committee) {
    where.push('mt.committee_id = @committee');
    params.committee = committee;
  }
  if (year) {
    where.push("substr(mt.meeting_date, 1, 4) = @year");
    params.year = year;
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const BASE_SELECT = `
  SELECT mt.*, c.name AS committee_name, a.name AS admin_name, a.username AS admin_username,
         (SELECT COUNT(*) FROM meeting_files f WHERE f.meeting_id = mt.id) AS file_count,
         (SELECT f.id FROM meeting_files f WHERE f.meeting_id = mt.id AND f.kind = 'image' ORDER BY f.id LIMIT 1) AS cover_id
  FROM meetings mt
  LEFT JOIN committees c ON c.id = mt.committee_id
  LEFT JOIN admins a ON a.id = mt.admin_id`;

const filesStmt = db.prepare('SELECT * FROM meeting_files WHERE meeting_id = ? ORDER BY id');

function getMeeting(id) {
  const m = db.prepare(`${BASE_SELECT} WHERE mt.id = ?`).get(Number(id));
  if (!m) return null;
  return { ...m, attendeeList: parseAttendees(m.attendees), files: filesStmt.all(m.id) };
}

router.get('/meetings', (req, res) => {
  const filters = meetingFilters(req.query);
  const { sql, params } = buildWhere(filters);
  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM meetings mt LEFT JOIN committees c ON c.id = mt.committee_id ${sql}`)
    .get(params).n;
  const pg = paginate(total, int(req.query.page), PER_PAGE);
  const rows = db
    .prepare(`${BASE_SELECT} ${sql} ORDER BY mt.meeting_date DESC, mt.meeting_time DESC, mt.id DESC LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit: PER_PAGE, offset: pg.offset });
  const filesByMeeting = new Map(rows.map((m) => [m.id, []]));
  if (rows.length) {
    db.prepare(
      `SELECT id, meeting_id, kind, original_name FROM meeting_files WHERE meeting_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`
    )
      .all(...rows.map((m) => m.id))
      .forEach((f) => filesByMeeting.get(f.meeting_id).push(f));
  }
  for (const m of rows) {
    m.attendeeCount = parseAttendees(m.attendees).length;
    m.files = filesByMeeting.get(m.id);
  }
  const years = db.prepare('SELECT DISTINCT substr(meeting_date, 1, 4) AS y FROM meetings ORDER BY y DESC').all().map((r) => r.y);
  const { view, ...rest } = filters;
  res.render('admin/meetings', {
    pageTitle: 'बैठक विवरण (मिनट्स)',
    filters,
    rows,
    pg,
    years,
    committees: committees(),
    qs: new URLSearchParams(Object.entries({ ...rest, view: view === 'list' ? 'list' : '' }).filter(([, v]) => v !== '' && v != null)).toString(),
  });
});

/** Approved members for the attendee picker; `committee` without `q` returns that whole committee. */
router.get('/meetings/members', (req, res) => {
  const q = str(req.query.q, 60);
  const committee = int(req.query.committee);
  const where = ["m.status = 'approved'"];
  const params = {};
  if (q) {
    where.push(`(m.name LIKE @q ESCAPE '\\' OR m.name_en LIKE @q ESCAPE '\\' OR m.member_no LIKE @q ESCAPE '\\' OR m.designation LIKE @q ESCAPE '\\')`);
    params.q = likeTerm(q);
  }
  if (committee) {
    where.push('m.committee_id = @committee');
    params.committee = committee;
  }
  const rows = db
    .prepare(
      `SELECT m.id, m.salutation, m.name, m.member_no, m.designation, c.name AS committee_name
       FROM members m LEFT JOIN committees c ON c.id = m.committee_id
       WHERE ${where.join(' AND ')}
       ORDER BY CASE m.category WHEN 'pramukh' THEN 0 WHEN 'padadhikari' THEN 1 ELSE 2 END, m.sort_order, m.name COLLATE NOCASE
       LIMIT ${committee && !q ? 200 : 20}`
    )
    .all(params);
  res.json({
    members: rows.map((m) => ({
      id: m.id,
      name: memberLabel(m),
      member_no: m.member_no || '',
      role: m.designation || '',
      place: [m.designation, m.committee_name].filter(Boolean).join(' • '),
    })),
  });
});

/** Linked members are re-labelled from the database; anyone else is kept as a typed name. */
function cleanAttendees(raw) {
  const list = parseAttendees(raw).slice(0, MAX_ATTENDEES);
  const ids = [...new Set(list.map((a) => int(a?.id)).filter(Boolean))];
  const known = new Map(
    ids.length
      ? db
          .prepare(`SELECT id, salutation, name, designation FROM members WHERE id IN (${ids.map(() => '?').join(',')})`)
          .all(...ids)
          .map((m) => [m.id, m])
      : []
  );
  const seen = new Set();
  const out = [];
  for (const a of list) {
    const m = known.get(int(a?.id));
    const entry = m
      ? { id: m.id, name: memberLabel(m), role: str(m.designation, 80) }
      : { name: str(a?.name, 100), role: str(a?.role, 80) };
    const key = entry.id ? `m${entry.id}` : `n${entry.name}`;
    if (!entry.name || seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

function parseMeeting(body, req) {
  const errors = [];
  const title = str(body.title, 200);
  if (!title) errors.push('बैठक का शीर्षक / विषय लिखें।');
  const date = isISODate(body.meeting_date) ? body.meeting_date : '';
  if (!date) errors.push('बैठक की तिथि दर्ज करें।');
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(body.meeting_time) ? body.meeting_time : null;
  const committeeId = int(body.committee_id);
  const committee = committeeId ? db.prepare('SELECT id FROM committees WHERE id = ?').get(committeeId) : null;
  const v = {
    title,
    meeting_date: date,
    meeting_time: time,
    venue: str(body.venue, 200),
    committee_id: committee ? committee.id : null,
    attendees: JSON.stringify(cleanAttendees(body.attendees)),
    minutes: cleanHtml(body.minutes),
  };
  if (errors.length && filesFor(req, 'files').length) errors.push('संलग्न फ़ाइलें कृपया दोबारा चुनें।');
  return { v, errors };
}

function blankMeeting() {
  return { title: '', meeting_date: '', meeting_time: '', venue: '', committee_id: null, attendeeList: [], minutes: '', files: [] };
}

function renderForm(res, m, errors = []) {
  res.status(errors.length ? 422 : 200).render('admin/meeting-form', {
    pageTitle: m.id ? 'बैठक विवरण संपादित करें' : 'नई बैठक दर्ज करें',
    m,
    errors,
    committees: committees(),
  });
}

/** Store uploaded register scans; any invalid file aborts before the meeting row is written. */
function saveUploads(req) {
  const saved = [];
  try {
    for (const f of filesFor(req, 'files')) {
      const { file, kind } = saveDocument(f.buffer);
      saved.push({ file, kind, original_name: str(f.originalname, 150), size: f.size });
    }
  } catch (err) {
    for (const s of saved) removeUpload(s.file);
    throw err;
  }
  return saved;
}

const insertFile = db.prepare(
  'INSERT INTO meeting_files (meeting_id, file, kind, original_name, size) VALUES (@meeting_id, @file, @kind, @original_name, @size)'
);

router.get('/meetings/new', (req, res) => renderForm(res, blankMeeting()));

router.post('/meetings', (req, res) => {
  const body = req.body ?? {};
  const { v, errors } = parseMeeting(body, req);
  if (errors.length) return renderForm(res, { ...v, attendeeList: JSON.parse(v.attendees), files: [] }, errors);
  const uploads = saveUploads(req);
  const id = tx(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO meetings (title, meeting_date, meeting_time, venue, committee_id, attendees, minutes, admin_id)
         VALUES (@title, @meeting_date, @meeting_time, @venue, @committee_id, @attendees, @minutes, @admin_id)`
      )
      .run({ ...v, admin_id: req.admin.id });
    for (const u of uploads) insertFile.run({ ...u, meeting_id: lastInsertRowid });
    return lastInsertRowid;
  });
  flash(req, 'success', `बैठक "${v.title}" दर्ज की गई${uploads.length ? ` (${uploads.length} संलग्न फ़ाइलें)` : ''}।`);
  res.redirect(`/admin/meetings/${id}`);
});

router.get('/meetings/files/:fid', (req, res, next) => {
  const f = db.prepare('SELECT * FROM meeting_files WHERE id = ?').get(int(req.params.fid));
  const file = f && privatePath(f.file);
  if (!file) return next();
  const name = f.original_name || `meeting-${f.meeting_id}-${f.id}.${f.file.split('.').pop()}`;
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.set('Content-Disposition', `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(file, (err) => err && next());
});

router.get('/meetings/:id', (req, res, next) => {
  const m = getMeeting(req.params.id);
  if (!m) return next();
  res.render('admin/meeting', { pageTitle: m.title, m });
});

router.get('/meetings/:id/edit', (req, res, next) => {
  const m = getMeeting(req.params.id);
  if (!m) return next();
  renderForm(res, m);
});

router.post('/meetings/:id', (req, res, next) => {
  const existing = getMeeting(req.params.id);
  if (!existing) return next();
  const body = req.body ?? {};
  const { v, errors } = parseMeeting(body, req);
  if (errors.length) return renderForm(res, { ...existing, ...v, attendeeList: JSON.parse(v.attendees) }, errors);
  const removeIds = new Set([].concat(body.remove_files ?? []).map((x) => int(x)));
  const removed = existing.files.filter((f) => removeIds.has(f.id));
  const uploads = saveUploads(req);
  tx(() => {
    db.prepare(
      `UPDATE meetings SET title = @title, meeting_date = @meeting_date, meeting_time = @meeting_time, venue = @venue,
         committee_id = @committee_id, attendees = @attendees, minutes = @minutes, updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`
    ).run({ ...v, id: existing.id });
    for (const f of removed) db.prepare('DELETE FROM meeting_files WHERE id = ?').run(f.id);
    for (const u of uploads) insertFile.run({ ...u, meeting_id: existing.id });
  });
  for (const f of removed) removeUpload(f.file);
  flash(req, 'success', 'बैठक विवरण अपडेट किया गया।');
  res.redirect(`/admin/meetings/${existing.id}`);
});

router.post('/meetings/:id/delete', requireSuper, (req, res) => {
  const m = getMeeting(req.params.id);
  if (m) {
    db.prepare('DELETE FROM meetings WHERE id = ?').run(m.id);
    for (const f of m.files) removeUpload(f.file);
    flash(req, 'success', `बैठक "${m.title}" और उसकी ${m.files.length} संलग्न फ़ाइलें हटाई गईं।`);
  }
  res.redirect('/admin/meetings');
});

export default router;

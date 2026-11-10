import express from 'express';
import { db, tx } from '../../db.js';
import { PEOPLE_GROUPS } from '../../config.js';
import { flash } from '../../middleware/auth.js';
import { getSite, setSetting, getSetting, DEFAULT_SITE } from '../../lib/settings.js';
import { cleanHtml } from '../../lib/sanitize.js';
import { afterMandalRenamed, mandalMemberCount } from '../../lib/mandals.js';
import { fileFor, filesFor, saveImage, removeUpload } from '../../lib/uploads.js';
import { str, text, int, bool, slugify } from '../../lib/util.js';

const router = express.Router();

export const ICON_CHOICES = ['book-open', 'heart', 'flag', 'users', 'award', 'star', 'shield', 'sun', 'home', 'calendar', 'briefcase', 'gift'];

/* ---------- Site settings ---------- */

const SITE_IMAGES = ['logo', 'hero_image', 'receipt_qr'];
const SITE_TEXT_FIELDS = Object.keys(DEFAULT_SITE).filter((k) => ![...SITE_IMAGES, 'wall_member_posts'].includes(k));

router.get('/site', async (req, res) => {
  res.render('admin/site', {
    pageTitle: 'संस्था एवं वेबसाइट सेटिंग',
    s: await getSite(),
    receiptStart: Number(await getSetting('receipt_start', 1)) || 1,
  });
});

router.post('/site', async (req, res) => {
  const body = req.body ?? {};
  const current = await getSite();
  const saved = { ...await getSetting('site', {}) };
  for (const key of SITE_TEXT_FIELDS) {
    const max = ['hero_subtitle', 'footer_about', 'address'].includes(key) ? 600 : 200;
    saved[key] = key === 'map_embed' ? cleanMapUrl(body[key]) : text(body[key], max);
  }
  saved.member_prefix = (str(body.member_prefix, 10).replace(/[^A-Za-z0-9]/g, '') || 'ARVS').toUpperCase();
  saved.wall_member_posts = Boolean(bool(body.wall_member_posts));
  saved.upi_id = /^[\w.-]{2,64}@[\w.-]{2,64}$/.test(str(body.upi_id, 140)) ? str(body.upi_id, 140) : '';
  const receiptStart = int(body.receipt_start);
  if (receiptStart && receiptStart > 0) await setSetting('receipt_start', receiptStart);
  for (const key of SITE_IMAGES) {
    const file = fileFor(req, key);
    if (file) {
      saved[key] = saveImage(file.buffer);
      removeUpload(current[key]);
    } else if (body[`reset_${key}`]) {
      removeUpload(current[key]);
      delete saved[key];
    }
  }
  await setSetting('site', saved);
  flash(req, 'success', 'वेबसाइट सेटिंग सहेजी गई।');
  res.redirect('/admin/site');
});

/** Accept either an embed URL or a pasted <iframe> snippet; keep only a Google Maps embed URL. */
function cleanMapUrl(value) {
  const s = String(value ?? '').trim();
  const m = /src="([^"]+)"/.exec(s);
  const url = m ? m[1] : s;
  return /^https:\/\/(www\.)?google\.com\/maps\/embed\?/.test(url) ? url.slice(0, 1500) : '';
}

/* ---------- Sections (CMS) ---------- */

const SECTION_BODY_LABELS = {
  about: ['परिचय विवरण'],
  president: ['संदेश'],
  'vision-mission': ['दृष्टि (Vision)', 'ध्येय (Mission)'],
};

const BLOCK_MANAGE_LINKS = {
  leadership: ['/admin/r/people', 'संस्थापक एवं नेतृत्व प्रबंधित करें'],
  trustees: ['/admin/r/people', 'ट्रस्टी मंडल प्रबंधित करें'],
  programs: ['/admin/r/programs', 'कार्यक्रम प्रबंधित करें'],
  events: ['/admin/r/events', 'आयोजन प्रबंधित करें'],
  directory: ['/admin/members', 'सदस्य सूची प्रबंधित करें'],
  wall: ['/admin/wall', 'सामुदायिक मंच प्रबंधित करें'],
  join: ['/admin/applications', 'आवेदन देखें'],
  contact: ['/admin/site', 'संपर्क विवरण बदलें'],
};

router.get('/sections', async (req, res) => {
  const sections = await db.prepare('SELECT * FROM sections ORDER BY sort_order, id').all();
  res.render('admin/sections', { pageTitle: 'अनुभाग एवं पेज (CMS)', sections });
});

router.get('/sections/new', async (req, res) => {
  res.render('admin/section-form', {
    pageTitle: 'नया अनुभाग / पेज',
    s: { kind: 'custom', layout: 'image-right', show_on_home: 1, has_page: 0, show_in_nav: 0, visible: 1 },
    bodyLabels: ['विवरण'],
    manage: null,
    errors: [],
  });
});

async function parseSection(body, existing) {
  const isCustom = !existing || existing.kind === 'custom';
  const v = {
    title: str(body.title, 150),
    subtitle: str(body.subtitle, 200) || null,
    nav_label: str(body.nav_label, 40) || null,
    visible: bool(body.visible),
    show_on_home: bool(body.show_on_home),
  };
  if (!existing || existing.kind !== 'block') {
    v.body = cleanHtml(body.body) || null;
    v.layout = ['image-right', 'image-left', 'full'].includes(body.layout) ? body.layout : 'image-right';
  }
  if (existing?.slug === 'vision-mission') v.body2 = cleanHtml(body.body2) || null;
  if (isCustom) {
    v.has_page = bool(body.has_page);
    v.show_in_nav = v.has_page ? bool(body.show_in_nav) : 0;
    v.slug = slugify(body.slug || body.title);
  }
  const errors = v.title ? [] : ['शीर्षक आवश्यक है।'];
  if (isCustom) {
    const clash = await db.prepare('SELECT id FROM sections WHERE slug = ? AND id != ?').get(v.slug, existing?.id ?? 0);
    if (clash) errors.push('यह URL नाम (slug) पहले से उपयोग में है।');
  }
  return { v, errors };
}

function applySectionImage(req, v, existing) {
  const file = fileFor(req, 'image');
  if (file) {
    v.image = saveImage(file.buffer);
    removeUpload(existing?.image);
  } else if (req.body?.remove_image) {
    removeUpload(existing?.image);
    v.image = null;
  }
}

router.post('/sections', async (req, res) => {
  const { v, errors } = await parseSection(req.body ?? {}, null);
  if (errors.length) {
    return res.render('admin/section-form', { pageTitle: 'नया अनुभाग / पेज', s: { kind: 'custom', ...v }, bodyLabels: ['विवरण'], manage: null, errors });
  }
  applySectionImage(req, v, null);
  const maxOrder = (await db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS n FROM sections').get()).n;
  const cols = Object.keys(v);
  const info = await db
    .prepare(`INSERT INTO sections (kind, sort_order, updated_at, ${cols.join(', ')}) VALUES ('custom', @sort_order, CURRENT_TIMESTAMP, ${cols.map((c) => `@${c}`).join(', ')})`)
    .run({ ...v, sort_order: maxOrder + 10 });
  flash(req, 'success', 'नया अनुभाग बनाया गया।');
  res.redirect(`/admin/sections/${info.lastInsertRowid}/edit`);
});

router.get('/sections/:id/edit', async (req, res, next) => {
  const s = await db.prepare('SELECT * FROM sections WHERE id = ?').get(int(req.params.id, 0));
  if (!s) return next();
  res.render('admin/section-form', {
    pageTitle: `अनुभाग संपादन — ${s.title}`,
    s,
    bodyLabels: SECTION_BODY_LABELS[s.slug] || ['विवरण'],
    manage: BLOCK_MANAGE_LINKS[s.slug] || null,
    errors: [],
  });
});

router.post('/sections/:id', async (req, res, next) => {
  const existing = await db.prepare('SELECT * FROM sections WHERE id = ?').get(int(req.params.id, 0));
  if (!existing) return next();
  const { v, errors } = await parseSection(req.body ?? {}, existing);
  if (errors.length) {
    return res.render('admin/section-form', {
      pageTitle: `अनुभाग संपादन — ${existing.title}`,
      s: { ...existing, ...v },
      bodyLabels: SECTION_BODY_LABELS[existing.slug] || ['विवरण'],
      manage: BLOCK_MANAGE_LINKS[existing.slug] || null,
      errors,
    });
  }
  if (existing.kind !== 'block') applySectionImage(req, v, existing);
  const cols = Object.keys(v);
  await db.prepare(`UPDATE sections SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = @id`).run({
    ...v,
    id: existing.id,
  });
  flash(req, 'success', 'अनुभाग सहेजा गया।');
  res.redirect(`/admin/sections/${existing.id}/edit`);
});

router.post('/sections/:id/delete', async (req, res) => {
  const s = await db.prepare('SELECT * FROM sections WHERE id = ?').get(int(req.params.id, 0));
  if (s?.kind === 'custom') {
    await db.prepare('DELETE FROM sections WHERE id = ?').run(s.id);
    removeUpload(s.image);
    flash(req, 'success', 'अनुभाग हटाया गया।');
  } else {
    flash(req, 'error', 'मुख्य अनुभाग हटाए नहीं जा सकते — आप इन्हें छिपा सकते हैं।');
  }
  res.redirect('/admin/sections');
});

router.post('/sections/:id/toggle', async (req, res) => {
  await db.prepare('UPDATE sections SET visible = 1 - visible WHERE id = ?').run(int(req.params.id, 0));
  res.redirect('/admin/sections');
});

router.post('/sections/:id/move', async (req, res) => {
  await moveRow('sections', null, int(req.params.id, 0), req.body?.dir === 'up' ? -1 : 1);
  res.redirect('/admin/sections');
});

/** Swap a row with its neighbour and renumber sort_order within the (optional) group. */
async function moveRow(table, groupField, id, delta) {
  await tx(async () => {
    const row = await db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) return;
    const rows = groupField
      ? await db.prepare(`SELECT id FROM ${table} WHERE ${groupField} = ? ORDER BY sort_order, id`).all(row[groupField])
      : await db.prepare(`SELECT id FROM ${table} ORDER BY sort_order, id`).all();
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    const upd = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
    for (const [idx, rid] of ids.entries()) await upd.run((idx + 1) * 10, rid);
  });
}

/* ---------- Generic CRUD resources ---------- */

const groupLabel = Object.fromEntries(PEOPLE_GROUPS.map((g) => [g.key, g.label]));

const RESOURCES = {
  people: {
    table: 'people',
    title: 'नेतृत्व, संस्थापक एवं ट्रस्टी',
    singular: 'व्यक्ति',
    help: 'संस्थापक, नेतृत्व (कार्यकारिणी) एवं ट्रस्टी मंडल के प्रोफ़ाइल कार्ड। क्रम बदलने के लिए ↑ ↓ बटन का प्रयोग करें।',
    groupField: 'grp',
    orderBy: "CASE grp WHEN 'founder' THEN 0 WHEN 'leader' THEN 1 ELSE 2 END, sort_order, id",
    sortable: true,
    columns: [
      { key: 'photo', type: 'image' },
      { key: 'name', label: 'नाम' },
      { key: 'designation', label: 'पद' },
      { key: 'grp', label: 'समूह', map: groupLabel },
      { key: 'visible', label: 'दृश्य', type: 'bool' },
    ],
    fields: [
      { name: 'grp', label: 'समूह', type: 'select', options: PEOPLE_GROUPS.map((g) => [g.key, g.label]) },
      { name: 'name', label: 'नाम', type: 'text', required: true, max: 100 },
      { name: 'designation', label: 'पद / उपाधि', type: 'text', max: 100 },
      { name: 'place', label: 'स्थान', type: 'text', max: 100 },
      { name: 'bio', label: 'संक्षिप्त परिचय', type: 'textarea', max: 1000 },
      { name: 'photo', label: 'फोटो', type: 'image', hint: 'वर्गाकार (1:1) फोटो सबसे अच्छी दिखती है।' },
      { name: 'visible', label: 'वेबसाइट पर दिखाएँ', type: 'checkbox', default: 1 },
    ],
  },
  programs: {
    table: 'programs',
    title: 'कार्यक्रम एवं उद्देश्य',
    singular: 'कार्यक्रम',
    help: 'मुखपृष्ठ पर "कार्यक्रम एवं उद्देश्य" अनुभाग में दिखने वाले कार्ड।',
    orderBy: 'sort_order, id',
    sortable: true,
    columns: [
      { key: 'image', type: 'image' },
      { key: 'title', label: 'शीर्षक' },
      { key: 'summary', label: 'सारांश', truncate: 80 },
      { key: 'visible', label: 'दृश्य', type: 'bool' },
    ],
    fields: [
      { name: 'title', label: 'शीर्षक', type: 'text', required: true, max: 120 },
      { name: 'icon', label: 'आइकन', type: 'select', options: ICON_CHOICES.map((i) => [i, i]) },
      { name: 'summary', label: 'सारांश', type: 'textarea', max: 600 },
      { name: 'image', label: 'चित्र', type: 'image' },
      { name: 'visible', label: 'वेबसाइट पर दिखाएँ', type: 'checkbox', default: 1 },
    ],
  },
  events: {
    table: 'events',
    title: 'गतिविधियाँ एवं आयोजन',
    singular: 'आयोजन',
    help: 'आज या आगे की तिथि वाले आयोजन "आगामी" और पिछली तिथि वाले "पिछली झलकियाँ" में स्वतः दिखते हैं।',
    orderBy: 'event_date DESC, id DESC',
    sortable: false,
    columns: [
      { key: 'image', type: 'image' },
      { key: 'title', label: 'शीर्षक' },
      { key: 'event_date', label: 'तिथि', type: 'date' },
      { key: 'location', label: 'स्थान' },
      { key: 'visible', label: 'दृश्य', type: 'bool' },
    ],
    fields: [
      { name: 'title', label: 'शीर्षक', type: 'text', required: true, max: 150 },
      { name: 'event_date', label: 'तिथि', type: 'date' },
      { name: 'event_time', label: 'समय', type: 'text', max: 40, placeholder: 'जैसे: सुबह 10:30 बजे' },
      { name: 'location', label: 'स्थान', type: 'text', max: 150 },
      { name: 'summary', label: 'सारांश', type: 'textarea', max: 600 },
      { name: 'body', label: 'पूरा विवरण / समाचार', type: 'richtext' },
      { name: 'image', label: 'मुख्य चित्र', type: 'image' },
      { name: 'gallery', label: 'फोटो गैलरी', type: 'gallery', hint: 'एक साथ कई फोटो चुन सकते हैं।' },
      { name: 'visible', label: 'वेबसाइट पर दिखाएँ', type: 'checkbox', default: 1 },
    ],
  },
  mandals: {
    table: 'mandals',
    title: 'मंडल',
    singular: 'मंडल',
    help:
      'मंडल = सदस्यता फ़ॉर्म में लिखी विधानसभा। फ़ॉर्म में नई विधानसभा लिखते ही नया मंडल अपने आप बन जाता है। नाम बदलने पर उन सदस्यों के फ़ॉर्म की विधानसभा भी बदल जाती है; किसी दूसरे मंडल का नाम देने पर दोनों मंडल एक हो जाते हैं (जैसे "Bhosari" और "भोसरी")। जिस मंडल में सदस्य हैं, उसे हटाया नहीं जा सकता।',
    afterUpdate: async (id, values) =>
      (await afterMandalRenamed(id, values.name)) ? 'इसी नाम का मंडल पहले से था — दोनों मंडल एक कर दिए गए।' : null,
    beforeDelete: async (id) => {
      const n = await mandalMemberCount(id);
      return n ? `इस मंडल में ${n} सदस्य हैं — पहले उनकी विधानसभा बदलें या इसे किसी दूसरे मंडल के नाम में बदलकर एक करें।` : null;
    },
    orderBy: 'sort_order, id',
    sortable: true,
    columns: [
      { key: 'name', label: 'नाम' },
      { key: 'name_en', label: 'English' },
      { key: 'description', label: 'क्षेत्र', truncate: 70 },
    ],
    fields: [
      { name: 'name', label: 'मंडल का नाम', type: 'text', required: true, max: 80 },
      { name: 'name_en', label: 'अंग्रेज़ी नाम', type: 'text', max: 80 },
      { name: 'description', label: 'क्षेत्र / विवरण', type: 'textarea', max: 400 },
    ],
  },
  committees: {
    table: 'committees',
    title: 'समितियाँ',
    singular: 'समिति',
    help: 'कार्यकारिणी, युवा प्रकोष्ठ, महिला प्रकोष्ठ आदि समितियाँ।',
    orderBy: 'sort_order, id',
    sortable: true,
    columns: [
      { key: 'name', label: 'नाम' },
      { key: 'name_en', label: 'English' },
      { key: 'description', label: 'विवरण', truncate: 70 },
    ],
    fields: [
      { name: 'name', label: 'समिति का नाम', type: 'text', required: true, max: 80 },
      { name: 'name_en', label: 'अंग्रेज़ी नाम', type: 'text', max: 80 },
      { name: 'description', label: 'विवरण', type: 'textarea', max: 400 },
    ],
  },
};

function resource(req, res, next) {
  const r = RESOURCES[req.params.res];
  if (!r) return next('route');
  req.resource = r;
  res.locals.resKey = req.params.res;
  res.locals.r = r;
  next();
}

function parseFields(r, req) {
  const body = req.body ?? {};
  const values = {};
  const errors = [];
  for (const f of r.fields) {
    switch (f.type) {
      case 'text':
        values[f.name] = str(body[f.name], f.max || 200) || null;
        break;
      case 'textarea':
        values[f.name] = text(body[f.name], f.max || 2000) || null;
        break;
      case 'richtext':
        values[f.name] = cleanHtml(body[f.name]) || null;
        break;
      case 'date':
        values[f.name] = /^\d{4}-\d{2}-\d{2}$/.test(body[f.name] || '') ? body[f.name] : null;
        break;
      case 'select':
        values[f.name] = f.options.some(([k]) => k === body[f.name]) ? body[f.name] : f.options[0][0];
        break;
      case 'checkbox':
        values[f.name] = bool(body[f.name]);
        break;
      case 'image':
      case 'gallery':
        break;
      default:
        throw new Error(`Unknown field type: ${f.type}`);
    }
    if (f.required && !values[f.name]) errors.push(`${f.label} आवश्यक है।`);
  }
  return { values, errors };
}

/** Image fields are stored only after validation passes, so failed submits leave no orphan files. */
function applyFiles(r, req, values, existing) {
  const body = req.body ?? {};
  for (const f of r.fields) {
    if (f.type === 'image') {
      const file = fileFor(req, f.name);
      if (file) {
        values[f.name] = saveImage(file.buffer);
        removeUpload(existing?.[f.name]);
      } else if (body[`remove_${f.name}`]) {
        removeUpload(existing?.[f.name]);
        values[f.name] = null;
      }
    } else if (f.type === 'gallery') {
      let list = [];
      try {
        list = JSON.parse(existing?.[f.name] || '[]');
      } catch {
        list = [];
      }
      const remove = new Set([].concat(body[`remove_${f.name}`] || []));
      list = list.filter((p) => {
        if (!remove.has(p)) return true;
        removeUpload(p);
        return false;
      });
      for (const file of filesFor(req, f.name)) list.push(saveImage(file.buffer));
      values[f.name] = JSON.stringify(list.slice(0, 60));
    }
  }
}

router.get('/r/:res', resource, async (req, res) => {
  const r = req.resource;
  const rows = await db.prepare(`SELECT * FROM ${r.table} ORDER BY ${r.orderBy}`).all();
  res.render('admin/crud-list', { pageTitle: r.title, rows });
});

router.get('/r/:res/new', resource, async (req, res) => {
  const row = Object.fromEntries(req.resource.fields.map((f) => [f.name, f.default ?? (f.type === 'select' ? req.query[f.name] || '' : '')]));
  res.render('admin/crud-form', { pageTitle: `नया ${req.resource.singular}`, row, errors: [] });
});

router.post('/r/:res', resource, async (req, res) => {
  const r = req.resource;
  const { values, errors } = parseFields(r, req);
  if (errors.length) return res.render('admin/crud-form', { pageTitle: `नया ${r.singular}`, row: values, errors });
  applyFiles(r, req, values, null);
  if (r.sortable) {
    values.sort_order =
      (await db
        .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS n FROM ${r.table}${r.groupField ? ` WHERE ${r.groupField} = ?` : ''}`)
        .get(...(r.groupField ? [values[r.groupField]] : []))).n + 10;
  }
  const cols = Object.keys(values);
  await db.prepare(`INSERT INTO ${r.table} (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`).run(values);
  flash(req, 'success', `${r.singular} जोड़ा गया।`);
  res.redirect(`/admin/r/${req.params.res}`);
});

router.get('/r/:res/:id/edit', resource, async (req, res, next) => {
  const row = await db.prepare(`SELECT * FROM ${req.resource.table} WHERE id = ?`).get(int(req.params.id, 0));
  if (!row) return next();
  res.render('admin/crud-form', { pageTitle: `${req.resource.singular} संपादन`, row, errors: [] });
});

router.post('/r/:res/:id', resource, async (req, res, next) => {
  const r = req.resource;
  const existing = await db.prepare(`SELECT * FROM ${r.table} WHERE id = ?`).get(int(req.params.id, 0));
  if (!existing) return next();
  const { values, errors } = parseFields(r, req);
  if (errors.length) return res.render('admin/crud-form', { pageTitle: `${r.singular} संपादन`, row: { ...existing, ...values }, errors });
  applyFiles(r, req, values, existing);
  const cols = Object.keys(values);
  await db.prepare(`UPDATE ${r.table} SET ${cols.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`).run({ ...values, id: existing.id });
  const note = r.afterUpdate ? await r.afterUpdate(existing.id, values) : null;
  flash(req, 'success', note ? `परिवर्तन सहेजे गए। ${note}` : 'परिवर्तन सहेजे गए।');
  res.redirect(`/admin/r/${req.params.res}`);
});

router.post('/r/:res/:id/delete', resource, async (req, res) => {
  const r = req.resource;
  const row = await db.prepare(`SELECT * FROM ${r.table} WHERE id = ?`).get(int(req.params.id, 0));
  const blocked = row && r.beforeDelete ? await r.beforeDelete(row.id) : null;
  if (blocked) {
    flash(req, 'error', blocked);
  } else if (row) {
    await db.prepare(`DELETE FROM ${r.table} WHERE id = ?`).run(row.id);
    for (const f of r.fields) {
      if (f.type === 'image') removeUpload(row[f.name]);
      if (f.type === 'gallery') {
        try {
          JSON.parse(row[f.name] || '[]').forEach(removeUpload);
        } catch {
          // Corrupt gallery JSON: nothing reliable to clean up.
        }
      }
    }
    flash(req, 'success', `${r.singular} हटाया गया।`);
  }
  res.redirect(`/admin/r/${req.params.res}`);
});

router.post('/r/:res/:id/move', resource, async (req, res) => {
  const r = req.resource;
  if (r.sortable) await moveRow(r.table, r.groupField || null, int(req.params.id, 0), req.body?.dir === 'up' ? -1 : 1);
  res.redirect(`/admin/r/${req.params.res}`);
});

export default router;

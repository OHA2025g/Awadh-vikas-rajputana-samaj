import express from 'express';
import { db, tx } from '../../db.js';
import { CATEGORY_KEYS, CATEGORY_LABEL } from '../../config.js';
import { requireSuper, flash } from '../../middleware/auth.js';
import { getWhatsAppConfig, setSetting, getSite } from '../../lib/settings.js';
import { gatewayStatus, connectBaileys, disconnectBaileys, sendWhatsApp, isGatewayReady } from '../../lib/whatsapp.js';
import { VARIABLES, personalize, enqueueBroadcast } from '../../lib/broadcast.js';
import { str, text, int, maskPhone, normalizePhone, formatDate } from '../../lib/util.js';

const router = express.Router();

const idList = (v) => [].concat(v || []).map(Number).filter(Number.isInteger);

/** Resolve a broadcast target into approved members with a usable WhatsApp number. */
async function resolveTarget(body) {
  const type = ['all', 'mandal', 'committee', 'category'].includes(body?.type) ? body.type : 'all';
  const where = ["m.status = 'approved'"];
  let label = 'सभी स्वीकृत सदस्य';
  let ids = [];
  switch (type) {
    case 'mandal': {
      ids = idList(body.mandals);
      where.push(ids.length ? `m.mandal_id IN (${ids.join(',')})` : '0');
      const names = ids.length ? (await db.prepare(`SELECT name FROM mandals WHERE id IN (${ids.join(',')})`).all()).map((r) => r.name) : [];
      label = `मंडल: ${names.join(', ') || '—'}`;
      break;
    }
    case 'committee': {
      ids = idList(body.committees);
      where.push(ids.length ? `m.committee_id IN (${ids.join(',')})` : '0');
      const names = ids.length ? (await db.prepare(`SELECT name FROM committees WHERE id IN (${ids.join(',')})`).all()).map((r) => r.name) : [];
      label = `समिति: ${names.join(', ') || '—'}`;
      break;
    }
    case 'category': {
      const cats = [].concat(body.categories || []).filter((c) => CATEGORY_KEYS.includes(c));
      where.push(cats.length ? `m.category IN (${cats.map((c) => `'${c}'`).join(',')})` : '0');
      label = `श्रेणी: ${cats.map((c) => CATEGORY_LABEL[c]).join(', ') || '—'}`;
      break;
    }
    case 'all':
      break;
    default:
      throw new Error(`Unhandled target type: ${type}`);
  }
  const rows = await db
    .prepare(
      `SELECT m.id, m.name, m.salutation, m.member_no, m.city, m.designation, m.phone, m.whatsapp,
              md.name AS mandal_name, c.name AS committee_name
       FROM members m LEFT JOIN mandals md ON md.id = m.mandal_id LEFT JOIN committees c ON c.id = m.committee_id
       WHERE ${where.join(' AND ')} ORDER BY m.name`
    )
    .all();
  const seen = new Set();
  const recipients = [];
  for (const m of rows) {
    const phone = normalizePhone(m.whatsapp) || normalizePhone(m.phone);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    recipients.push({ ...m, target_phone: phone });
  }
  return { label, recipients };
}

function broadcastJson(b) {
  return {
    id: b.id,
    target_label: b.target_label,
    total: b.total,
    sent: b.sent,
    failed: b.failed,
    status: b.status,
    created: formatDate(b.created_at, 'datetime'),
    message: b.message,
  };
}

router.get('/whatsapp', async (req, res) => {
  const cfg = await getWhatsAppConfig();
  res.render('admin/whatsapp', {
    pageTitle: 'व्हाट्सऐप प्रसारण',
    cfg: { ...cfg, cloud_token: cfg.cloud_token ? '••••••••' : '' },
    hasToken: Boolean(cfg.cloud_token),
    gateway: gatewayStatus(),
    variables: VARIABLES,
    mandals: await db.prepare('SELECT id, name FROM mandals ORDER BY sort_order, id').all(),
    committees: await db.prepare('SELECT id, name FROM committees ORDER BY sort_order, id').all(),
    broadcasts: (await db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 20').all()).map(broadcastJson),
  });
});

router.get('/whatsapp/status', async (req, res) => {
  res.json({ ok: true, gateway: gatewayStatus() });
});

router.post('/whatsapp/connect', async (req, res) => {
  if ((await getWhatsAppConfig()).provider !== 'baileys') {
    return res.status(422).json({ ok: false, error: 'QR गेटवे चुना हुआ नहीं है।' });
  }
  connectBaileys().catch((err) => console.error('[whatsapp]', err.message));
  res.json({ ok: true, gateway: gatewayStatus() });
});

router.post('/whatsapp/disconnect', async (req, res) => {
  await disconnectBaileys({ logout: false });
  res.json({ ok: true, gateway: gatewayStatus() });
});

router.post('/whatsapp/logout', requireSuper, async (req, res) => {
  await disconnectBaileys({ logout: true });
  res.json({ ok: true, gateway: gatewayStatus() });
});

router.post('/whatsapp/config', requireSuper, async (req, res) => {
  const b = req.body ?? {};
  const current = await getWhatsAppConfig();
  const provider = ['baileys', 'cloud', 'none'].includes(b.provider) ? b.provider : current.provider;
  const next = {
    provider,
    cloud_phone_id: str(b.cloud_phone_id, 40),
    cloud_token: b.cloud_token && !String(b.cloud_token).startsWith('••') ? str(b.cloud_token, 600) : current.cloud_token,
    cloud_template: str(b.cloud_template, 80),
    cloud_lang: str(b.cloud_lang, 10) || 'hi',
    cloud_api_version: /^v\d+\.\d+$/.test(b.cloud_api_version || '') ? b.cloud_api_version : current.cloud_api_version,
    delay_min: Math.max(1, Math.min(120, int(b.delay_min, current.delay_min))),
    delay_max: Math.max(1, Math.min(300, int(b.delay_max, current.delay_max))),
  };
  if (next.delay_max < next.delay_min) next.delay_max = next.delay_min;
  if (b.clear_token) next.cloud_token = '';
  await setSetting('whatsapp', next);
  if (current.provider === 'baileys' && provider !== 'baileys') await disconnectBaileys({ logout: false });
  flash(req, 'success', 'व्हाट्सऐप सेटिंग सहेजी गई।');
  res.redirect('/admin/whatsapp');
});

router.post('/whatsapp/preview', async (req, res) => {
  const { label, recipients } = await resolveTarget(req.body?.target);
  const sample = recipients[0];
  res.json({
    ok: true,
    label,
    count: recipients.length,
    recipients: recipients.slice(0, 50).map((m) => ({ name: m.name, mandal: m.mandal_name || '', phone: maskPhone(m.target_phone) })),
    preview: personalize(text(req.body?.message, 4000), sample || { name: 'राजेश सिंह' }, await getSite()),
  });
});

router.post('/whatsapp/send', async (req, res) => {
  const message = text(req.body?.message, 4000);
  if (message.length < 2) return res.status(422).json({ ok: false, error: 'कृपया संदेश लिखें।' });
  const { label, recipients } = await resolveTarget(req.body?.target);
  if (!recipients.length) return res.status(422).json({ ok: false, error: 'चुने गए समूह में कोई सदस्य नहीं है।' });

  const id = await tx(async () => {
    const info = await db
      .prepare("INSERT INTO broadcasts (message, target_label, provider, total, status, admin_id) VALUES (?, ?, ?, ?, 'queued', ?)")
      .run(message, label, (await getWhatsAppConfig()).provider, recipients.length, req.admin.id);
    const ins = db.prepare('INSERT INTO broadcast_recipients (broadcast_id, member_id, phone) VALUES (?, ?, ?)');
    for (const r of recipients) await ins.run(info.lastInsertRowid, r.id, r.target_phone);
    return Number(info.lastInsertRowid);
  });
  enqueueBroadcast(id);
  res.json({
    ok: true,
    broadcast: broadcastJson(await db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)),
    warning: isGatewayReady() ? null : 'गेटवे अभी जुड़ा नहीं है — प्रसारण रुका रहेगा। कनेक्ट करने के बाद "पुनः आरंभ" दबाएँ।',
  });
});

router.post('/whatsapp/test', requireSuper, async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(422).json({ ok: false, error: 'मान्य मोबाइल नंबर लिखें।' });
  try {
    await sendWhatsApp(phone, text(req.body?.message, 1000) || `${(await getSite()).org_name} — परीक्षण संदेश ✅`);
    res.json({ ok: true });
  } catch (err) {
    res.status(422).json({ ok: false, error: err.message });
  }
});

router.get('/whatsapp/broadcasts/:id', async (req, res, next) => {
  const b = await db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(int(req.params.id, 0));
  if (!b) return next();
  const recipients = (await db
    .prepare(
      `SELECT r.status, r.error, r.phone, m.name FROM broadcast_recipients r LEFT JOIN members m ON m.id = r.member_id
       WHERE r.broadcast_id = ? ORDER BY CASE r.status WHEN 'failed' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, r.id LIMIT 500`
    )
    .all(b.id))
    .map((r) => ({ name: r.name || '—', phone: maskPhone(r.phone), status: r.status, error: r.error }));
  res.json({ ok: true, broadcast: broadcastJson(b), recipients });
});

router.post('/whatsapp/broadcasts/:id/:action', async (req, res) => {
  const id = int(req.params.id, 0);
  const b = await db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id);
  if (!b) return res.status(404).json({ ok: false, error: 'प्रसारण नहीं मिला।' });
  switch (req.params.action) {
    case 'pause':
      await db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ? AND status IN ('running', 'queued')").run(id);
      break;
    case 'resume':
      if (b.status === 'paused') {
        if (!isGatewayReady()) return res.status(422).json({ ok: false, error: 'पहले व्हाट्सऐप गेटवे कनेक्ट करें।' });
        enqueueBroadcast(id);
      }
      break;
    case 'retry':
      await db.prepare("UPDATE broadcast_recipients SET status = 'pending', error = NULL WHERE broadcast_id = ? AND status = 'failed'").run(id);
      await db.prepare("UPDATE broadcasts SET failed = 0, status = 'paused' WHERE id = ?").run(id);
      if (isGatewayReady()) enqueueBroadcast(id);
      break;
    case 'cancel':
      await db.prepare("UPDATE broadcast_recipients SET status = 'skipped' WHERE broadcast_id = ? AND status = 'pending'").run(id);
      await db.prepare("UPDATE broadcasts SET status = 'cancelled', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      break;
    default:
      return res.status(400).json({ ok: false, error: 'अमान्य कार्य।' });
  }
  res.json({ ok: true, broadcast: broadcastJson(await db.prepare('SELECT * FROM broadcasts WHERE id = ?').get(id)) });
});

export default router;

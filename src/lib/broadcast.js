import { db } from '../db.js';
import { GatewayNotReadyError, sendWhatsApp } from './whatsapp.js';
import { getSite, getWhatsAppConfig } from './settings.js';
import { sleep } from './util.js';

export const VARIABLES = [
  { tag: '{member_name}', label: 'सदस्य का नाम' },
  { tag: '{salutation}', label: 'संबोधन (श्री/श्रीमती)' },
  { tag: '{member_id}', label: 'सदस्य क्रमांक' },
  { tag: '{mandal}', label: 'मंडल' },
  { tag: '{committee}', label: 'समिति' },
  { tag: '{designation}', label: 'पद' },
  { tag: '{city}', label: 'शहर' },
  { tag: '{org_name}', label: 'संस्था का नाम' },
];

const memberStmt = db.prepare(`
  SELECT m.*, md.name AS mandal_name, c.name AS committee_name
  FROM members m
  LEFT JOIN mandals md ON md.id = m.mandal_id
  LEFT JOIN committees c ON c.id = m.committee_id
  WHERE m.id = ?`);

export function personalize(template, member, site) {
  const values = {
    member_name: member.name || 'सदस्य',
    salutation: member.salutation || '',
    member_id: member.member_no || '',
    mandal: member.mandal_name || '',
    committee: member.committee_name || '',
    designation: member.designation || '',
    city: member.city || '',
    org_name: site.org_name,
  };
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? values[key] : match));
}

const queue = [];
let running = null;

export function enqueueBroadcast(id) {
  db.prepare("UPDATE broadcasts SET status = 'queued' WHERE id = ? AND status = 'paused'").run(id);
  if (!queue.includes(id) && running !== id) queue.push(id);
  pump();
}

function pump() {
  if (running || queue.length === 0) return;
  running = queue.shift();
  runBroadcast(running)
    .catch((err) => {
      console.error('[broadcast]', err);
      db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ? AND status = 'running'").run(running);
    })
    .finally(() => {
      running = null;
      pump();
    });
}

const nextRecipient = db.prepare(
  "SELECT * FROM broadcast_recipients WHERE broadcast_id = ? AND status = 'pending' ORDER BY id LIMIT 1"
);
const markSent = db.prepare(
  "UPDATE broadcast_recipients SET status = 'sent', error = NULL, sent_at = CURRENT_TIMESTAMP WHERE id = ?"
);
const markFailed = db.prepare("UPDATE broadcast_recipients SET status = 'failed', error = ? WHERE id = ?");
const bumpSent = db.prepare('UPDATE broadcasts SET sent = sent + 1 WHERE id = ?');
const bumpFailed = db.prepare('UPDATE broadcasts SET failed = failed + 1 WHERE id = ?');

async function runBroadcast(id) {
  const started = db
    .prepare("UPDATE broadcasts SET status = 'running' WHERE id = ? AND status = 'queued'")
    .run(id);
  if (started.changes === 0) return;
  const site = getSite();

  for (;;) {
    const b = db.prepare('SELECT status, message FROM broadcasts WHERE id = ?').get(id);
    if (!b || b.status !== 'running') return;
    const r = nextRecipient.get(id);
    if (!r) break;

    const member = (r.member_id && memberStmt.get(r.member_id)) || {};
    try {
      await sendWhatsApp(r.phone, personalize(b.message, member, site));
      markSent.run(r.id);
      bumpSent.run(id);
    } catch (err) {
      if (err instanceof GatewayNotReadyError) {
        db.prepare("UPDATE broadcasts SET status = 'paused' WHERE id = ?").run(id);
        return;
      }
      markFailed.run(String(err.message || err).slice(0, 300), r.id);
      bumpFailed.run(id);
    }

    const cfg = getWhatsAppConfig();
    const min = Math.max(0, Number(cfg.delay_min) || 0);
    const max = Math.max(min, Number(cfg.delay_max) || min);
    const delayMs = cfg.provider === 'cloud' ? 250 : (min + Math.random() * (max - min)) * 1000;
    await sleep(delayMs);
  }

  db.prepare("UPDATE broadcasts SET status = 'done', finished_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

export function pauseInterruptedBroadcasts() {
  db.prepare("UPDATE broadcasts SET status = 'paused' WHERE status IN ('running', 'queued')").run();
}

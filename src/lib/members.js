import { db, tx } from '../db.js';
import { CATEGORY_KEYS, CATEGORY_LABEL } from '../config.js';
import { getSite, getSetting, setSetting } from './settings.js';
import { maskPhone } from './util.js';

const BASE_SELECT = `
  SELECT m.*, md.name AS mandal_name, c.name AS committee_name
  FROM members m
  LEFT JOIN mandals md ON md.id = m.mandal_id
  LEFT JOIN committees c ON c.id = m.committee_id`;

const CATEGORY_ORDER = `CASE m.category WHEN 'pramukh' THEN 0 WHEN 'padadhikari' THEN 1 ELSE 2 END`;

export function likeTerm(q) {
  return `%${String(q).replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Build a WHERE clause from member filters. `ids` restricts to an explicit list.
 */
function buildWhere({ status, category, mandal, committee, q, publicOnly, ids, cert } = {}) {
  const where = [];
  const params = {};
  if (status) {
    where.push('m.status = @status');
    params.status = status;
  }
  if (cert === 'printed') where.push('m.cert_print_count > 0');
  if (cert === 'unprinted') where.push('m.cert_print_count = 0');
  if (publicOnly) where.push("m.status = 'approved' AND m.show_in_directory = 1");
  if (category && CATEGORY_KEYS.includes(category)) {
    where.push('m.category = @category');
    params.category = category;
  }
  if (mandal) {
    where.push('m.mandal_id = @mandal');
    params.mandal = Number(mandal);
  }
  if (committee) {
    where.push('m.committee_id = @committee');
    params.committee = Number(committee);
  }
  if (q) {
    where.push(
      `(m.name ILIKE @q ESCAPE E'\\\\' OR m.name_en ILIKE @q ESCAPE E'\\\\' OR m.member_no ILIKE @q ESCAPE E'\\\\' OR m.city ILIKE @q ESCAPE E'\\\\' OR m.application_no ILIKE @q ESCAPE E'\\\\' OR m.designation ILIKE @q ESCAPE E'\\\\')`
    );
    params.q = likeTerm(q);
  }
  if (Array.isArray(ids)) {
    const clean = ids.map(Number).filter(Number.isInteger);
    where.push(clean.length ? `m.id IN (${clean.join(',')})` : '0');
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export async function listMembers(filters = {}, { limit = 50, offset = 0, order = 'category' } = {}) {
  const { sql, params } = buildWhere(filters);
  const orderBy =
    order === 'recent'
      ? 'm.created_at DESC, m.id DESC'
      : `${CATEGORY_ORDER}, m.sort_order, m.name`;
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM members m ${sql}`).get(params)).n;
  const rows = await db
    .prepare(`${BASE_SELECT} ${sql} ORDER BY ${orderBy} LIMIT @limit OFFSET @offset`)
    .all({ ...params, limit, offset });
  return { rows, total };
}

export async function allMembers(filters = {}) {
  const { sql, params } = buildWhere(filters);
  return await db.prepare(`${BASE_SELECT} ${sql} ORDER BY ${CATEGORY_ORDER}, m.sort_order, m.name`).all(params);
}

export async function getMember(id) {
  return (await db.prepare(`${BASE_SELECT} WHERE m.id = ?`).get(Number(id))) || null;
}

export async function categoryCounts({ publicOnly = true, status } = {}) {
  const { sql, params } = buildWhere({ publicOnly, status });
  const rows = await db.prepare(`SELECT m.category AS k, COUNT(*) AS n FROM members m ${sql} GROUP BY m.category`).all(params);
  const counts = { all: 0 };
  for (const key of CATEGORY_KEYS) counts[key] = 0;
  for (const r of rows) {
    counts[r.k] = r.n;
    counts.all += r.n;
  }
  return counts;
}

export async function findActiveByPhone(phone) {
  return await db.prepare("SELECT id, status, application_no FROM members WHERE phone = ? AND status != 'rejected'").get(phone);
}

/** Fields that are safe to show on the public website. */
export function toPublicMember(m) {
  return {
    id: m.id,
    member_no: m.member_no,
    salutation: m.salutation,
    name: m.name,
    category: m.category,
    category_label: CATEGORY_LABEL[m.category] || '',
    designation: m.designation,
    mandal: m.mandal_name,
    committee: m.committee_name,
    city: m.city,
    photo: m.photo,
    phone: maskPhone(m.phone),
  };
}

export async function approveMember(id, patch) {
  return tx(async () => {
    const m = await db.prepare('SELECT id, member_no FROM members WHERE id = ?').get(id);
    if (!m) return null;
    let memberNo = m.member_no;
    if (!memberNo) {
      const prefix = (await getSite()).member_prefix || 'M';
      const n = (Number(await getSetting('member_counter', 0)) || 0) + 1;
      await setSetting('member_counter', n);
      memberNo = `${prefix}-${String(n).padStart(4, '0')}`;
    }
    await db.prepare(
      `UPDATE members SET status = 'approved', member_no = @memberNo, category = @category, designation = @designation,
         mandal_id = @mandal_id, committee_id = @committee_id, show_in_directory = @show_in_directory,
         approved_at = COALESCE(approved_at, CURRENT_TIMESTAMP), reject_reason = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = @id`
    ).run({ ...patch, memberNo, id });
    return memberNo;
  });
}

export function nextApplicationNo(id) {
  return `AV${String(id).padStart(5, '0')}`;
}

/** Records a certificate print for each approved member; returns how many were marked. */
export async function markCertificatesPrinted(ids, adminId) {
  const find = db.prepare("SELECT id, cert_serial FROM members WHERE id = ? AND status = 'approved'");
  const bump = db.prepare('UPDATE members SET cert_printed_at = CURRENT_TIMESTAMP, cert_print_count = cert_print_count + 1 WHERE id = ?');
  const log = db.prepare('INSERT INTO certificate_log (member_id, serial, admin_id) VALUES (?, ?, ?)');
  return tx(async () => {
    let n = 0;
    for (const id of ids) {
      const m = await find.get(id);
      if (!m) continue;
      await bump.run(m.id);
      await log.run(m.id, m.cert_serial, adminId);
      n += 1;
    }
    return n;
  });
}

/** Clears the printed status, e.g. after a misprint that has to be redone. */
export async function clearCertificatesPrinted(ids) {
  const clear = db.prepare("UPDATE members SET cert_printed_at = NULL, cert_print_count = 0 WHERE id = ? AND status = 'approved'");
  return tx(async () => {
    let n = 0;
    for (const id of ids) n += (await clear.run(id)).changes;
    return n;
  });
}

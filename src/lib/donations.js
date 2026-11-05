import { db } from '../db.js';
import { DONATION_CATEGORY_KEYS, PAYMENT_MODE_KEYS } from '../config.js';
import { likeTerm } from './members.js';
import { str, isISODate } from './util.js';

const DONOR_NAME = `COALESCE(TRIM(COALESCE(m.salutation, '') || ' ' || m.name), d.donor_name)`;

const BASE_SELECT = `
  SELECT d.*, ${DONOR_NAME} AS name, m.member_no, m.status AS member_status,
         a.name AS admin_name, a.username AS admin_username
  FROM donations d
  LEFT JOIN members m ON m.id = d.member_id
  LEFT JOIN admins a ON a.id = COALESCE(d.updated_by, d.admin_id)`;

export function donationFilters(query = {}) {
  return {
    category: DONATION_CATEGORY_KEYS.includes(query.category) ? query.category : '',
    mode: PAYMENT_MODE_KEYS.includes(query.mode) ? query.mode : '',
    from: isISODate(query.from) ? query.from : '',
    to: isISODate(query.to) ? query.to : '',
    q: str(query.q, 60),
  };
}

/** The public page searches donor names only, and never matches a गुप्त सहयोग entry. */
function buildWhere({ category, mode, from, to, q } = {}, { isPublic = false } = {}) {
  const where = [];
  const params = {};
  if (category) {
    where.push('d.category = @category');
    params.category = category;
  }
  if (mode) {
    where.push('d.payment_mode = @mode');
    params.mode = mode;
  }
  if (from) {
    where.push('d.paid_on >= @from');
    params.from = from;
  }
  if (to) {
    where.push('d.paid_on <= @to');
    params.to = to;
  }
  if (q) {
    where.push(
      isPublic
        ? `(d.anonymous = 0 AND ${DONOR_NAME} ILIKE @q ESCAPE E'\\\\')`
        : `(${DONOR_NAME} ILIKE @q ESCAPE E'\\\\' OR m.member_no ILIKE @q ESCAPE E'\\\\' OR d.reference ILIKE @q ESCAPE E'\\\\' OR d.details ILIKE @q ESCAPE E'\\\\' OR d.phone ILIKE @q ESCAPE E'\\\\')`
    );
    params.q = likeTerm(q);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const ORDER = 'ORDER BY d.paid_on DESC, d.id DESC';

export async function listDonations(filters, { limit = 50, offset = 0, isPublic = false } = {}) {
  const { sql, params } = buildWhere(filters, { isPublic });
  const { n: total, sum } = await db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(d.amount_paise), 0) AS sum FROM donations d LEFT JOIN members m ON m.id = d.member_id ${sql}`)
    .get(params);
  const rows = await db.prepare(`${BASE_SELECT} ${sql} ${ORDER} LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset });
  return { rows, total, sum };
}

export async function allDonations(filters) {
  const { sql, params } = buildWhere(filters);
  return await db.prepare(`${BASE_SELECT} ${sql} ${ORDER}`).all(params);
}

export async function getDonation(id) {
  return (await db.prepare(`${BASE_SELECT} WHERE d.id = ?`).get(Number(id))) || null;
}

/** Entry count and total (paise) per category, plus an `all` bucket, for the given date/mode filters. */
export async function donationTotals(filters = {}, opts = {}) {
  const { sql, params } = buildWhere({ ...filters, category: '' }, opts);
  const rows = await db
    .prepare(
      `SELECT d.category AS k, COUNT(*) AS n, COALESCE(SUM(d.amount_paise), 0) AS sum
       FROM donations d LEFT JOIN members m ON m.id = d.member_id ${sql} GROUP BY d.category`
    )
    .all(params);
  const totals = { all: { n: 0, sum: 0 } };
  for (const key of DONATION_CATEGORY_KEYS) totals[key] = { n: 0, sum: 0 };
  for (const r of rows) {
    if (!totals[r.k]) continue;
    totals[r.k] = { n: r.n, sum: r.sum };
    totals.all.n += r.n;
    totals.all.sum += r.sum;
  }
  return totals;
}

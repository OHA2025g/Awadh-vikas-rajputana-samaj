const TZ = 'Asia/Kolkata';

/** Normalise an Indian mobile number to 12 digits (91XXXXXXXXXX). Returns '' if invalid. */
export function normalizePhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  if (d.length === 12 && d.startsWith('91') && /^[6-9]/.test(d.slice(2))) return d;
  return '';
}

/** +91 98******12 */
export function maskPhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length < 6) return d ? '******' : '';
  const local = d.length > 10 ? d.slice(-10) : d;
  const cc = d.length > 10 ? `+${d.slice(0, d.length - 10)} ` : '';
  return `${cc}${local.slice(0, 2)}${'*'.repeat(local.length - 4)}${local.slice(-2)}`;
}

/** +91 98765 43210 */
export function formatPhone(phone) {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  return d;
}

/** tel: link for the first number of a "73507 75050, 95525 16767" style list. */
export function telHref(phones) {
  const first = String(phones ?? '').split(/[,/]/)[0].replace(/[^\d+]/g, '');
  return `tel:${first}`;
}

/** XXXX XXXX 9012 */
export function maskAadhaar(aadhaar) {
  const d = String(aadhaar ?? '').replace(/\D/g, '');
  return d ? `XXXX XXXX ${d.slice(-4)}` : '';
}

/** 1234 5678 9012 */
export function formatAadhaar(aadhaar) {
  return String(aadhaar ?? '')
    .replace(/\D/g, '')
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

const inrWhole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inrFraction = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,00,000 — paise are shown only when present (₹501.50). */
export function formatINR(paise) {
  const n = Number(paise) || 0;
  return `₹${n % 100 === 0 ? inrWhole.format(n / 100) : inrFraction.format(n / 100)}`;
}

export function entryCount(n) {
  return `${n} ${n === 1 ? 'प्रविष्टि' : 'प्रविष्टियाँ'}`;
}

const MAX_AMOUNT_PAISE = 999_999_999 * 100;

/** "₹ 1,00,000.50" → 10000050 paise; null unless a positive amount up to ₹99,99,99,999. */
export function parseAmountPaise(raw) {
  const s = String(raw ?? '').replace(/[₹,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return paise > 0 && paise <= MAX_AMOUNT_PAISE ? paise : null;
}

/** Last four characters only: XXXX4821 */
export function maskReference(ref) {
  const s = String(ref ?? '').replace(/\s+/g, '');
  if (!s) return '';
  return s.length <= 4 ? 'XXXX' : `XXXX${s.slice(-4)}`;
}

/** Strict YYYY-MM-DD that is also a real calendar date. */
export function isISODate(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** SQLite CURRENT_TIMESTAMP values are UTC without a zone marker. */
export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00+05:30`);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(`${s.replace(' ', 'T')}Z`);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dateFmt = new Intl.DateTimeFormat('hi-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
const shortFmt = new Intl.DateTimeFormat('hi-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
const dateTimeFmt = new Intl.DateTimeFormat('hi-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: TZ,
});
const numericFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ });
const dayFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: TZ });
const monthFmt = new Intl.DateTimeFormat('hi-IN', { month: 'short', timeZone: TZ });

export function formatDate(value, style = 'long') {
  const d = parseDate(value);
  if (!d) return '';
  if (style === 'short') return shortFmt.format(d);
  if (style === 'datetime') return dateTimeFmt.format(d);
  if (style === 'numeric') return numericFmt.format(d);
  return dateFmt.format(d);
}

export function dateParts(value) {
  const d = parseDate(value);
  if (!d) return { day: '', month: '' };
  return { day: dayFmt.format(d), month: monthFmt.format(d) };
}

export function todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}

export function relativeTime(value) {
  const d = parseDate(value);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'अभी-अभी';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} मिनट पहले`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} घंटे पहले`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day} दिन पहले`;
  return formatDate(d);
}

export function str(value, max = 500) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function text(value, max = 5000) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, max);
}

export function int(value, fallback = null) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function bool(value) {
  return value === true || value === 'on' || value === '1' || value === 1 || value === 'true' ? 1 : 0;
}

export function slugify(value) {
  const s = String(value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0900-\u097f]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s || `section-${Date.now().toString(36)}`;
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function initials(name) {
  const parts = String(name ?? '')
    .replace(/^(श्री|श्रीमती|कु\.|सुश्री|डॉ\.|ठा\.|स्व\.)\s*/u, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => Array.from(p)[0])
    .join('');
}

export function paginate(total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, page || 1), pages);
  return { total, pages, page: current, perPage, offset: (current - 1) * perPage };
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function csvCell(v) {
  const s = String(v ?? '');
  // Leading =,+,-,@ would be evaluated as a formula by spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function nl2p(s) {
  return text(s)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

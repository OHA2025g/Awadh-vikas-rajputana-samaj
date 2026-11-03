import crypto from 'node:crypto';
import { db } from '../db.js';

export const DEFAULT_SITE = {
  org_name: 'अवध राजपूत विकास संघ',
  org_name_en: 'Awadh Rajput Vikas Sangh',
  city: 'पुणे',
  tagline: 'एकता • शिक्षा • संस्कार • सेवा',
  slogan: 'संगठित समाज, सशक्त समाज',
  reg_no: 'पुणे/०००४२८/२०२५',
  established: '2015',
  address: 'फ्लॅट नंबर-३४४, लक्ष्मी अपार्टमेंट, शनिवार पेठ, पुणे-४११ ०३०.',
  phone: '73507 75050, 95525 16767, 84460 13416',
  email: 'awadhrajputvikashsang@gmail.com',
  whatsapp: '',
  facebook: '',
  instagram: '',
  youtube: '',
  map_embed: '',
  logo: '/img/logo.svg',
  hero_image: '/img/hero.jpg',
  hero_badge: 'पुणे में बसे अवध के राजपूत परिवारों का संगठन',
  hero_title: 'अवध राजपूत विकास संघ',
  hero_subtitle:
    'संगठन में शक्ति, संस्कारों में पहचान — आइए, मिलकर समाज के शैक्षणिक, सामाजिक एवं आर्थिक उत्थान का संकल्प लें।',
  footer_about:
    'अवध राजपूत विकास संघ पुणे एवं आसपास बसे अवध क्षेत्र के राजपूत परिवारों को एक सूत्र में पिरोने वाली सामाजिक संस्था है।',
  member_prefix: 'ARVS',
  wall_member_posts: true,
};

export const DEFAULT_WHATSAPP = {
  provider: 'baileys',
  cloud_phone_id: '',
  cloud_token: '',
  cloud_template: '',
  cloud_lang: 'hi',
  cloud_api_version: 'v23.0',
  delay_min: 4,
  delay_max: 9,
};

/**
 * Positions are millimetres on an A4 landscape sheet (297 x 210), measured
 * from the top-left corner of the paper. Font sizes are in points.
 *
 * Text fields (name, date, serial): x is the left edge of the text box and y
 * is the text baseline — the line the letters sit on. Signature: x/width give
 * the box, y is its bottom edge (the printed signature line).
 *
 * Defaults are measured from the society's pre-printed sheet.
 */
export const CALIBRATION_VERSION = 2;

export const DEFAULT_CALIBRATION = {
  offsetX: 0,
  offsetY: 0,
  name: {
    x: 127,
    y: 113.6,
    width: 138,
    fontSize: 20,
    font: 'Tiro Devanagari Hindi',
    weight: 700,
    color: '#1b2a6b',
    align: 'center',
    salutation: false,
  },
  signature: { x: 213, y: 178, width: 40, height: 16 },
  date: { enabled: true, x: 128.5, y: 184, fontSize: 14, hindiDigits: false },
  serial: { enabled: false, x: 244.5, y: 71.7, fontSize: 13, prefix: '' },
  design: {
    reg_line: 'रजि. नंबर : पुणे/०००४२८/२०२५',
    trust_line: 'Number in the Register of Public Trusts F-0066456(PUN)',
    address: 'फ्लॅट नंबर-३४४, लक्ष्मी अपार्टमेंट, शनिवार पेठ, पुणे-४११ ०३०.',
    ribbon: 'सदस्य प्रमाण पत्र',
    body: [
      'आपको **{org_name}, {city}** संस्था का **आजीवन सदस्य** बनने पर हार्दिक बधाई',
      'एवं शुभकामनायें। हमें आपको यह **सदस्य प्रमाण पत्र** प्रदान करते हुए बहुत खुशी हो रही है।',
      'संस्था आपका हार्दिक स्वागत करती है।',
    ].join('\n'),
    duties_title: 'कर्तव्य',
    duties_head: 'राजपूत अर्थात क्षत्रीय',
    duties: [
      'राजपूत अर्थात सत्यवाचक',
      'राजपूत अर्थात कर्तव्य परायण',
      'राजपूत अर्थात मानवता वादी',
      'राजपूत अर्थात राष्ट्र रक्षक',
      'राजपूत अर्थात मातृशक्ति रक्षक',
      'राजपूत अर्थात प्रजापालन',
      'राजपूत अर्थात प्रकृति रक्षक',
      'राजपूत अर्थात जीव मात्र से प्रेम',
      'राजपूत अर्थात धर्म रक्षक',
      'राजपूत अर्थात वेद रक्षक',
      'राजपूत अर्थात योगी',
    ].join('\n'),
  },
};

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

export function getSetting(key, fallback = null) {
  const row = getStmt.get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function setSetting(key, value) {
  setStmt.run(key, JSON.stringify(value));
}

export function getSite() {
  return { ...DEFAULT_SITE, ...getSetting('site', {}) };
}

export function getWhatsAppConfig() {
  return { ...DEFAULT_WHATSAPP, ...getSetting('whatsapp', {}) };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Deep-merge saved values over defaults so new default keys appear after upgrades. */
function mergeDefaults(defaults, saved) {
  const out = { ...defaults };
  if (!isPlainObject(saved)) return out;
  for (const [k, v] of Object.entries(saved)) {
    if (!(k in defaults)) continue;
    out[k] = isPlainObject(defaults[k]) ? mergeDefaults(defaults[k], v) : v;
  }
  return out;
}

/**
 * Calibrations saved before field Y became the text baseline would print in the
 * wrong place, so only their printer offsets are carried over.
 */
export function getCalibration() {
  const saved = getSetting('print_calibration', {});
  if (saved?.version === CALIBRATION_VERSION) return mergeDefaults(DEFAULT_CALIBRATION, saved);
  const legacy = {};
  for (const k of ['offsetX', 'offsetY']) if (Number.isFinite(saved?.[k])) legacy[k] = saved[k];
  return mergeDefaults(DEFAULT_CALIBRATION, legacy);
}

export function saveCalibration(input) {
  setSetting('print_calibration', { ...sanitizeCalibration(input), version: CALIBRATION_VERSION });
}

/** Keep only known keys with values of the same type as the defaults. */
export function sanitizeCalibration(input, defaults = DEFAULT_CALIBRATION) {
  const out = {};
  for (const [k, def] of Object.entries(defaults)) {
    const v = input?.[k];
    if (isPlainObject(def)) {
      out[k] = sanitizeCalibration(v, def);
    } else if (typeof def === 'number') {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? Math.max(-1000, Math.min(1000, n)) : def;
    } else if (typeof def === 'boolean') {
      out[k] = v === true || v === 'true' || v === 1 || v === '1';
    } else {
      out[k] = typeof v === 'string' ? v.slice(0, 600) : def;
    }
  }
  return out;
}

export function getSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let secret = getSetting('session_secret');
  if (!secret) {
    secret = crypto.randomBytes(32).toString('hex');
    setSetting('session_secret', secret);
  }
  return secret;
}

/** Atomically take the next value of a named counter. */
export function nextCounter(key) {
  const current = Number(getSetting(key, 0)) || 0;
  const next = current + 1;
  setSetting(key, next);
  return next;
}

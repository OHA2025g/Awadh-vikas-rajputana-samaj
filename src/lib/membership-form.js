import { str, text, int, normalizePhone, isValidEmail } from './util.js';

export const FAMILY_ROWS = 6;
export const RELATIVE_ROWS = 4;

const PINCODE = /^\d{6}$/;
const AADHAAR = /^[2-9]\d{11}$/;

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/** Parses a stored `family` / `relatives` JSON column. */
export function formRows(json) {
  try {
    const rows = JSON.parse(json || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Table rows are posted as `<prefix>_<n>_<key>`; empty rows are dropped. */
function parseRows(body, prefix, count, withAddress, errors) {
  const rows = [];
  for (let i = 1; i <= count; i++) {
    const field = (k) => body[`${prefix}_${i}_${k}`];
    const row = { name: str(field('name'), 80), age: int(field('age')), relation: str(field('relation'), 40) };
    if (withAddress) row.address = str(field('address'), 120);
    const rawPhone = str(field('phone'), 20);
    row.phone = rawPhone ? normalizePhone(rawPhone) : '';
    if (rawPhone && !row.phone) errors[`${prefix}_${i}_phone`] = 'मोबाइल नंबर मान्य नहीं है।';
    if (row.age !== null && (row.age < 0 || row.age > 120)) errors[`${prefix}_${i}_age`] = 'उम्र सही लिखें।';
    if (!row.name && (row.relation || rawPhone || row.address || row.age !== null)) errors[`${prefix}_${i}_name`] = 'नाम लिखें।';
    if (row.name) rows.push(row);
  }
  return rows;
}

/**
 * Fields of the printed सदस्यता फॉर्म (everything except mobile, photo and signature, which callers handle).
 * `strict` applies the public form's required fields.
 */
export function parseFormFields(body, { strict = false } = {}) {
  const errors = {};
  const v = {
    name: str(body.name, 80),
    age: int(body.age),
    aadhaar: digits(body.aadhaar) || null,
    vansh: str(body.vansh, 60) || null,
    gotra: str(body.gotra, 60) || null,
    email: str(body.email, 120) || null,
    father_name: str(body.father_name, 80) || null,
    perm_village: str(body.perm_village, 60) || null,
    perm_post: str(body.perm_post, 60) || null,
    perm_block: str(body.perm_block, 60) || null,
    perm_tehsil: str(body.perm_tehsil, 60) || null,
    perm_district: str(body.perm_district, 60) || null,
    perm_pincode: digits(body.perm_pincode) || null,
    address: text(body.address, 300) || null,
    ward_no: str(body.ward_no, 30) || null,
    vidhan_sabha: str(body.vidhan_sabha, 60) || null,
    district: str(body.district, 60) || null,
    state: str(body.state, 60) || null,
    country: str(body.country, 60) || null,
    pincode: digits(body.pincode) || null,
  };
  v.family = JSON.stringify(parseRows(body, 'family', FAMILY_ROWS, false, errors));
  v.relatives = JSON.stringify(parseRows(body, 'relative', RELATIVE_ROWS, true, errors));
  v.city = str(body.city, 60) || v.vidhan_sabha || v.district || null;
  v.native_place = str(body.native_place, 100) || [v.perm_village, v.perm_district].filter(Boolean).join(', ') || null;

  if (v.name.length < 2) errors.name = 'कृपया सदस्य का पूरा नाम लिखें।';
  if (v.age === null ? strict : v.age < 1 || v.age > 120) errors.age = 'कृपया सही उम्र लिखें।';
  if (v.aadhaar && !AADHAAR.test(v.aadhaar)) errors.aadhaar = 'आधार कार्ड नंबर 12 अंकों का होना चाहिए।';
  if (v.email && !isValidEmail(v.email)) errors.email = 'ईमेल पता मान्य नहीं है।';
  if (v.perm_pincode && !PINCODE.test(v.perm_pincode)) errors.perm_pincode = 'पिनकोड 6 अंकों का होना चाहिए।';
  if (v.pincode && !PINCODE.test(v.pincode)) errors.pincode = 'पिनकोड 6 अंकों का होना चाहिए।';
  if (strict) {
    if (!v.father_name || v.father_name.length < 2) errors.father_name = 'माता / पिता या पति का नाम आवश्यक है।';
    if (!v.perm_village) errors.perm_village = 'स्थायी पते का ग्राम लिखें।';
    if (!v.perm_district) errors.perm_district = 'स्थायी पते का जिला लिखें।';
    if (!v.address || v.address.length < 5) errors.address = 'कृपया वर्तमान पता लिखें।';
  }
  return { v, errors };
}

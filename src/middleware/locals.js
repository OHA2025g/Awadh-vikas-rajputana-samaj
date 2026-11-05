import { db } from '../db.js';
import { getSite } from '../lib/settings.js';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  POST_CATEGORIES,
  POST_CATEGORY_LABEL,
  STATUS_LABEL,
  ROLE_LABEL,
  DONATION_CATEGORIES,
  DONATION_CATEGORY_LABEL,
  LIFETIME_FEE_PAISE,
  PAYMENT_MODES,
  PAYMENT_MODE_LABEL,
} from '../config.js';
import {
  formatDate,
  relativeTime,
  maskPhone,
  formatPhone,
  maskAadhaar,
  formatAadhaar,
  telHref,
  initials,
  dateParts,
  formatINR,
  entryCount,
} from '../lib/util.js';
import { formRows, FAMILY_ROWS, RELATIVE_ROWS } from '../lib/membership-form.js';

const navPagesStmt = db.prepare(
  "SELECT slug, nav_label, title FROM sections WHERE kind = 'custom' AND has_page = 1 AND show_in_nav = 1 AND visible = 1 ORDER BY sort_order"
);

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
}

export async function viewHelpers(req, res, next) {
  res.locals.site = await getSite();
  res.locals.navPages = await navPagesStmt.all();
  res.locals.currentPath = req.path;
  res.locals.icon = icon;
  res.locals.formatDate = formatDate;
  res.locals.relativeTime = relativeTime;
  res.locals.dateParts = dateParts;
  res.locals.maskPhone = maskPhone;
  res.locals.formatPhone = formatPhone;
  res.locals.maskAadhaar = maskAadhaar;
  res.locals.formatAadhaar = formatAadhaar;
  res.locals.telHref = telHref;
  res.locals.formRows = formRows;
  res.locals.FAMILY_ROWS = FAMILY_ROWS;
  res.locals.RELATIVE_ROWS = RELATIVE_ROWS;
  res.locals.initials = initials;
  res.locals.CATEGORIES = CATEGORIES;
  res.locals.CATEGORY_LABEL = CATEGORY_LABEL;
  res.locals.POST_CATEGORIES = POST_CATEGORIES;
  res.locals.POST_CATEGORY_LABEL = POST_CATEGORY_LABEL;
  res.locals.STATUS_LABEL = STATUS_LABEL;
  res.locals.ROLE_LABEL = ROLE_LABEL;
  res.locals.DONATION_CATEGORIES = DONATION_CATEGORIES;
  res.locals.DONATION_CATEGORY_LABEL = DONATION_CATEGORY_LABEL;
  res.locals.LIFETIME_FEE_PAISE = LIFETIME_FEE_PAISE;
  res.locals.PAYMENT_MODES = PAYMENT_MODES;
  res.locals.PAYMENT_MODE_LABEL = PAYMENT_MODE_LABEL;
  res.locals.formatINR = formatINR;
  res.locals.entryCount = entryCount;
  res.locals.pageTitle = '';
  next();
}

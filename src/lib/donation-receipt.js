import fs from 'node:fs/promises';
import path from 'node:path';
import ejs from 'ejs';
import QRCode from 'qrcode';
import { db } from '../db.js';
import { DONATION_CATEGORY_LABEL, PAYMENT_MODE_LABEL, ROOT, UPLOAD_DIR } from '../config.js';
import { getDonation } from './donations.js';
import { getSetting, getSite } from './settings.js';
import { sendWhatsApp, sendWhatsAppDocument } from './whatsapp.js';
import { htmlToReceiptPdf } from './receipt-pdf.js';
import { normalizePhone, formatINR, formatDate, formatPhone, amountInWordsHi } from './util.js';

const SEND_TIMEOUT_MS = 25_000;
const PDF_TIMEOUT_MS = 45_000;
const RECEIPT_VIEW = path.join(ROOT, 'views', 'admin', 'receipt-print.ejs');
const RECEIPT_CSS = path.join(ROOT, 'public', 'css', 'receipt.css');
const PUBLIC_DIR = path.join(ROOT, 'public');
const IMAGE_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/** Reasons in the order and wording of the printed रसीद. */
export const RECEIPT_REASONS = [
  { key: 'lifetime', label: 'आजीवन सदस्यता शुल्क' },
  { key: 'daan', label: 'दान' },
  { key: 'aayojan', label: 'आयोजन सहयोग' },
  { key: 'other', label: 'अन्य:' },
];

/** Number entered on the सहयोग entry first, then the member's WhatsApp, then their mobile. */
export function donationPhone(d) {
  return normalizePhone(d.phone) || normalizePhone(d.member_whatsapp) || normalizePhone(d.member_phone);
}

/** Next रसीद क्रमांक; never below the starting number set in site settings. */
export async function nextReceiptNo() {
  const start = Number(await getSetting('receipt_start', 1)) || 1;
  const { last } = await db.prepare('SELECT COALESCE(MAX(receipt_no), 0) AS last FROM donations').get();
  return Math.max(Number(last) + 1, start);
}

/** Values printed on the रसीद; `showPhone` decides how much of the mobile number appears. */
export function receiptView(d, showPhone = formatPhone) {
  const phone = donationPhone(d);
  return {
    ...d,
    date_out: formatDate(d.paid_on, 'numeric'),
    phone_out: phone ? showPhone(phone) : '',
    residence: d.member_address || d.member_city || '',
    amount_out: formatINR(d.amount_paise),
    words_out: amountInWordsHi(d.amount_paise),
    mode_out: [PAYMENT_MODE_LABEL[d.payment_mode] || d.payment_mode, d.reference].filter(Boolean).join(' — '),
  };
}

/** The uploaded QR image, else a UPI payment QR generated from the UPI ID. */
export async function receiptQr(site) {
  if (site.receipt_qr) return site.receipt_qr;
  if (!site.upi_id) return '';
  const params = new URLSearchParams({ pa: site.upi_id, pn: site.org_name_en || site.org_name, cu: 'INR' });
  return QRCode.toDataURL(`upi://pay?${params}`, { margin: 0, width: 240 });
}

/** A site image path (`/uploads/…` or a file under public/) as a data URL; other values pass through. */
async function embedImage(src) {
  if (!src || !src.startsWith('/') || src.startsWith('//')) return src || '';
  const rel = decodeURIComponent(src.split(/[?#]/)[0]);
  const [base, sub] = rel.startsWith('/uploads/') ? [UPLOAD_DIR, rel.slice('/uploads/'.length)] : [PUBLIC_DIR, rel.slice(1)];
  const file = path.resolve(base, sub);
  const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
  if (!type || !file.startsWith(base + path.sep)) return '';
  try {
    return `data:${type};base64,${(await fs.readFile(file)).toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * The same रसीद as the print page, as a PDF for the donor (full mobile number: it is their own).
 * Styles and images are embedded because the headless page cannot load them from this server.
 */
export async function receiptPdf(d, site) {
  const html = await ejs.renderFile(RECEIPT_VIEW, {
    site: { ...site, logo: await embedImage(site.logo) },
    receipts: [receiptView(d)],
    reasons: RECEIPT_REASONS,
    qr: await embedImage(await receiptQr(site)),
    inlineCss: await fs.readFile(RECEIPT_CSS, 'utf8'),
    single: true,
  });
  return htmlToReceiptPdf(html);
}

export const receiptFileName = (d) => `Receipt-${d.receipt_no}.pdf`;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function thanksMessage(d, site) {
  const lines = [
    `🙏 नमस्ते ${d.name} जी,`,
    '',
    `${site.org_name} को आपका भुगतान प्राप्त हुआ है। आपके सहयोग के लिए हार्दिक धन्यवाद!`,
    '',
    `🧾 रसीद क्रमांक: ${d.receipt_no}`,
    `📅 दिनांक: ${formatDate(d.paid_on, 'numeric')}`,
    `💰 राशि: ${formatINR(d.amount_paise)} (${amountInWordsHi(d.amount_paise)})`,
    `📌 प्रयोजन: ${DONATION_CATEGORY_LABEL[d.category] || d.category}`,
    `💳 भुगतान माध्यम: ${PAYMENT_MODE_LABEL[d.payment_mode] || d.payment_mode}`,
  ];
  if (d.reference) lines.push(`🔖 संदर्भ संख्या: ${d.reference}`);
  if (d.details) lines.push(`📝 विवरण: ${d.details}`);
  lines.push('', 'आपका सहयोग समाज सेवा के कार्यों को और सशक्त बनाता है। 🙏', `— ${site.org_name}${site.city ? `, ${site.city}` : ''}`);
  return lines.join('\n');
}

const saveStatus = db.prepare(
  `UPDATE donations SET wa_status = @status, wa_error = @error,
     wa_sent_at = CASE WHEN @status = 'sent' THEN CURRENT_TIMESTAMP ELSE wa_sent_at END
   WHERE id = @id`
);

/** Sends the thank-you / confirmation message and records the outcome on the entry. */
export async function sendDonationThanks(id) {
  const d = await getDonation(id);
  if (!d) return { ok: false, error: 'प्रविष्टि नहीं मिली।' };
  const phone = donationPhone(d);
  if (!phone) {
    await saveStatus.run({ id: d.id, status: 'no_phone', error: 'मोबाइल नंबर उपलब्ध नहीं है।' });
    return { ok: false, error: 'इस प्रविष्टि / सदस्य का मोबाइल नंबर उपलब्ध नहीं है।' };
  }
  const site = await getSite();
  try {
    await withTimeout(sendWhatsApp(phone, thanksMessage(d, site)), SEND_TIMEOUT_MS, 'व्हाट्सऐप से उत्तर नहीं मिला (समय समाप्त)।');
  } catch (err) {
    const error = String(err?.message || err).slice(0, 300);
    await saveStatus.run({ id: d.id, status: 'failed', error });
    return { ok: false, error };
  }
  // The text has gone out; a PDF problem is reported but does not make the message "failed".
  let pdfError = null;
  try {
    const send = async () =>
      sendWhatsAppDocument(phone, {
        buffer: await receiptPdf(d, site),
        fileName: receiptFileName(d),
        caption: `रसीद क्रमांक ${d.receipt_no} — ${site.org_name}`,
      });
    await withTimeout(send(), PDF_TIMEOUT_MS, 'PDF रसीद भेजने में बहुत देर हुई (समय समाप्त)।');
  } catch (err) {
    pdfError = String(err?.message || err).slice(0, 250);
  }
  await saveStatus.run({ id: d.id, status: 'sent', error: pdfError ? `PDF: ${pdfError}` : null });
  return { ok: true, pdfError };
}

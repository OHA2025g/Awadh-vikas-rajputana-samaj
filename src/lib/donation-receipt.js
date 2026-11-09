import { db } from '../db.js';
import { DONATION_CATEGORY_LABEL, PAYMENT_MODE_LABEL } from '../config.js';
import { getDonation } from './donations.js';
import { getSetting, getSite } from './settings.js';
import { sendWhatsApp } from './whatsapp.js';
import { normalizePhone, formatINR, formatDate, amountInWordsHi } from './util.js';

const SEND_TIMEOUT_MS = 25_000;

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
  try {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('व्हाट्सऐप से उत्तर नहीं मिला (समय समाप्त)।')), SEND_TIMEOUT_MS);
    });
    await Promise.race([sendWhatsApp(phone, thanksMessage(d, await getSite())), timeout]).finally(() => clearTimeout(timer));
    await saveStatus.run({ id: d.id, status: 'sent', error: null });
    return { ok: true };
  } catch (err) {
    const error = String(err?.message || err).slice(0, 300);
    await saveStatus.run({ id: d.id, status: 'failed', error });
    return { ok: false, error };
  }
}

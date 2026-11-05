import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const PRIVATE_DIR = path.join(DATA_DIR, 'private');
export const WA_AUTH_DIR = path.join(DATA_DIR, 'wa-auth');
export const PORT = Number(process.env.PORT) || 3000;
export const IS_PROD = process.env.NODE_ENV === 'production';

export const CATEGORIES = [
  { key: 'pramukh', label: 'प्रमुख', desc: 'संघ के मार्गदर्शक एवं प्रमुख पदों पर आसीन महानुभाव' },
  { key: 'padadhikari', label: 'पदाधिकारी', desc: 'कार्यकारिणी, प्रकोष्ठ एवं समितियों के पदाधिकारी' },
  { key: 'sadasya', label: 'सदस्य', desc: 'संघ के सभी आजीवन एवं सामान्य सदस्य' },
];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key);
export const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

export const PEOPLE_GROUPS = [
  { key: 'founder', label: 'संस्थापक' },
  { key: 'leader', label: 'नेतृत्व / कार्यकारिणी' },
  { key: 'trustee', label: 'ट्रस्टी मंडल' },
];

export const POST_CATEGORIES = [
  { key: 'announcement', label: 'घोषणा' },
  { key: 'event', label: 'कार्यक्रम' },
  { key: 'achievement', label: 'उपलब्धि' },
  { key: 'general', label: 'सामान्य चर्चा' },
];
export const POST_CATEGORY_LABEL = Object.fromEntries(POST_CATEGORIES.map((c) => [c.key, c.label]));

export const SALUTATIONS = ['श्री', 'श्रीमती', 'कु.', 'सुश्री', 'डॉ.', 'ठा.'];
export const GENDERS = ['पुरुष', 'महिला', 'अन्य'];

export const STATUS_LABEL = { pending: 'लंबित', approved: 'स्वीकृत', rejected: 'अस्वीकृत' };

export const ROLE_LABEL = { superadmin: 'मुख्य एडमिन', subadmin: 'सहायक एडमिन' };

export const DONATION_CATEGORIES = [
  { key: 'lifetime', label: 'आजीवन सदस्यता शुल्क', icon: 'award' },
  { key: 'daan', label: 'सहयोग', icon: 'heart' },
  { key: 'aayojan', label: 'आयोजन सहयोग', icon: 'calendar' },
  { key: 'other', label: 'अन्य', icon: 'gift' },
];
export const DONATION_CATEGORY_KEYS = DONATION_CATEGORIES.map((c) => c.key);
export const DONATION_CATEGORY_LABEL = Object.fromEntries(DONATION_CATEGORIES.map((c) => [c.key, c.label]));

/** आजीवन सदस्यता शुल्क is one fixed amount; every other category is entered per receipt. */
export const LIFETIME_FEE_PAISE = 600 * 100;

export const PAYMENT_MODES = [
  { key: 'cash', label: 'नकद (Cash)' },
  { key: 'online', label: 'ऑनलाइन (Online)' },
  { key: 'upi', label: 'UPI' },
  { key: 'cheque', label: 'चेक (Cheque)' },
];
export const PAYMENT_MODE_KEYS = PAYMENT_MODES.map((m) => m.key);
export const PAYMENT_MODE_LABEL = Object.fromEntries(PAYMENT_MODES.map((m) => [m.key, m.label]));

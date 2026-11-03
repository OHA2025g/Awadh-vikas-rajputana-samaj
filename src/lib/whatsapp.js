import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { WA_AUTH_DIR } from '../config.js';
import { getWhatsAppConfig } from './settings.js';

export class GatewayNotReadyError extends Error {}

const logger = pino({ level: 'silent' });
const MAX_QR_ROTATIONS = 6;
const MAX_RECONNECTS = 5;

const gateway = {
  status: 'disconnected', // disconnected | connecting | qr | connected
  qrDataUrl: null,
  account: null,
  message: 'व्हाट्सऐप जुड़ा नहीं है।',
  updatedAt: Date.now(),
};

let sock = null;
let qrCount = 0;
let reconnects = 0;

function setState(patch) {
  Object.assign(gateway, patch, { updatedAt: Date.now() });
}

function clearAuth() {
  fs.rmSync(WA_AUTH_DIR, { recursive: true, force: true });
}

export function hasSavedSession() {
  return fs.existsSync(path.join(WA_AUTH_DIR, 'creds.json'));
}

export function gatewayStatus() {
  const cfg = getWhatsAppConfig();
  switch (cfg.provider) {
    case 'cloud': {
      const ready = Boolean(cfg.cloud_phone_id && cfg.cloud_token);
      return {
        provider: 'cloud',
        status: ready ? 'connected' : 'disconnected',
        message: ready ? 'Meta Cloud API कॉन्फ़िगर है।' : 'Cloud API के लिए Phone Number ID और Access Token भरें।',
      };
    }
    case 'none':
      return { provider: 'none', status: 'disabled', message: 'व्हाट्सऐप गेटवे बंद है।' };
    case 'baileys':
    default:
      return { provider: 'baileys', ...gateway };
  }
}

export function isGatewayReady() {
  return gatewayStatus().status === 'connected';
}

export async function connectBaileys() {
  if (sock) return;
  qrCount = 0;
  reconnects = 0;
  await openSocket();
}

async function openSocket() {
  setState({ status: 'connecting', qrDataUrl: null, message: 'व्हाट्सऐप से जुड़ रहे हैं…' });
  fs.mkdirSync(WA_AUTH_DIR, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(WA_AUTH_DIR);
  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    version = undefined;
  }

  const s = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.ubuntu('Chrome'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  sock = s;
  s.ev.on('creds.update', saveCreds);
  s.ev.on('connection.update', (update) => {
    handleConnectionUpdate(s, update).catch((err) => {
      setState({ status: 'disconnected', message: `त्रुटि: ${err.message}` });
    });
  });
}

async function handleConnectionUpdate(s, { connection, lastDisconnect, qr }) {
  if (sock !== s) return;

  if (qr) {
    qrCount += 1;
    if (qrCount > MAX_QR_ROTATIONS) {
      sock = null;
      s.end(undefined);
      setState({
        status: 'disconnected',
        qrDataUrl: null,
        message: 'QR कोड का समय समाप्त हो गया। "कनेक्ट करें" दबाकर पुनः प्रयास करें।',
      });
      return;
    }
    setState({
      status: 'qr',
      qrDataUrl: await QRCode.toDataURL(qr, { margin: 1, width: 300 }),
      message: 'फ़ोन में व्हाट्सऐप खोलें → लिंक्ड डिवाइस → डिवाइस लिंक करें, और यह QR कोड स्कैन करें।',
    });
  }

  if (connection === 'open') {
    qrCount = 0;
    reconnects = 0;
    const number = String(s.user?.id || '').split(':')[0].split('@')[0];
    setState({
      status: 'connected',
      qrDataUrl: null,
      account: { name: s.user?.name || s.user?.verifiedName || '', number },
      message: 'व्हाट्सऐप सफलतापूर्वक जुड़ा हुआ है।',
    });
  }

  if (connection === 'close') {
    sock = null;
    const code = lastDisconnect?.error?.output?.statusCode;
    if (code === DisconnectReason.loggedOut) {
      clearAuth();
      setState({
        status: 'disconnected',
        qrDataUrl: null,
        account: null,
        message: 'फ़ोन से लॉग-आउट हो गया। पुनः जोड़ने के लिए QR स्कैन करें।',
      });
      return;
    }
    reconnects += 1;
    if (reconnects > MAX_RECONNECTS) {
      setState({ status: 'disconnected', qrDataUrl: null, message: 'कनेक्शन बार-बार टूट रहा है। कुछ देर बाद पुनः प्रयास करें।' });
      return;
    }
    setState({ status: 'connecting', message: 'कनेक्शन टूट गया, पुनः जुड़ रहे हैं…' });
    setTimeout(() => {
      openSocket().catch((err) => setState({ status: 'disconnected', message: `त्रुटि: ${err.message}` }));
    }, Math.min(30000, 1500 * reconnects));
  }
}

export async function disconnectBaileys({ logout = false } = {}) {
  const s = sock;
  sock = null;
  if (s) {
    try {
      if (logout) await s.logout();
      else s.end(undefined);
    } catch {
      // The socket may already be closed; local cleanup below is what matters.
    }
  }
  if (logout) clearAuth();
  setState({
    status: 'disconnected',
    qrDataUrl: null,
    account: logout ? null : gateway.account,
    message: logout ? 'व्हाट्सऐप लॉग-आउट किया गया।' : 'व्हाट्सऐप डिस्कनेक्ट किया गया।',
  });
}

export async function autoStartWhatsApp() {
  if (getWhatsAppConfig().provider === 'baileys' && hasSavedSession()) {
    await connectBaileys();
  }
}

/** phone: 12-digit number with country code, e.g. 919876543210 */
export async function sendWhatsApp(phone, text) {
  const cfg = getWhatsAppConfig();
  switch (cfg.provider) {
    case 'baileys':
      return sendViaBaileys(phone, text);
    case 'cloud':
      return sendViaCloud(cfg, phone, text);
    case 'none':
      throw new GatewayNotReadyError('व्हाट्सऐप गेटवे बंद है।');
    default:
      throw new GatewayNotReadyError(`अज्ञात गेटवे: ${cfg.provider}`);
  }
}

async function sendViaBaileys(phone, text) {
  if (!sock || gateway.status !== 'connected') {
    throw new GatewayNotReadyError('व्हाट्सऐप जुड़ा नहीं है।');
  }
  let jid = `${phone}@s.whatsapp.net`;
  let exists = true;
  try {
    const [result] = (await sock.onWhatsApp(jid)) || [];
    if (result) {
      exists = Boolean(result.exists);
      if (result.jid) jid = result.jid;
    }
  } catch {
    // The existence lookup is best-effort; fall through and attempt delivery.
  }
  if (!exists) throw new Error('यह नंबर व्हाट्सऐप पर पंजीकृत नहीं है।');
  await sock.sendMessage(jid, { text });
}

async function sendViaCloud(cfg, phone, text) {
  if (!cfg.cloud_phone_id || !cfg.cloud_token) {
    throw new GatewayNotReadyError('Cloud API सेटिंग अधूरी है।');
  }
  const url = `https://graph.facebook.com/${encodeURIComponent(cfg.cloud_api_version || 'v23.0')}/${encodeURIComponent(
    cfg.cloud_phone_id
  )}/messages`;
  // Business-initiated messages outside the 24h window must use an approved template.
  const payload = cfg.cloud_template
    ? {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: cfg.cloud_template,
          language: { code: cfg.cloud_lang || 'hi' },
          components: [
            {
              type: 'body',
              parameters: [{ type: 'text', text: text.replace(/\s*\n+\s*/g, ' | ').slice(0, 1000) }],
            },
          ],
        },
      }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text, preview_url: false } };

  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.cloud_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `Cloud API त्रुटि (HTTP ${res.status})`);
  }
}

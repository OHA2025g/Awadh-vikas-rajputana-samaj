import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

/*
 * The PDF is the print page rendered by headless Chromium: Hindi (Devanagari) needs real
 * text shaping, which plain PDF libraries get wrong. The browser stays up briefly between
 * receipts and closes itself when idle to free memory.
 */

const IDLE_CLOSE_MS = 3 * 60 * 1000;
const BROWSER_CANDIDATES = [
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

let browserPromise = null;
let idleTimer = null;

function browserPath() {
  const found = [process.env.CHROME_PATH, ...BROWSER_CANDIDATES].find((p) => p && fs.existsSync(p));
  if (!found) throw new Error('PDF बनाने के लिए सर्वर पर Chromium उपलब्ध नहीं है।');
  return found;
}

async function getBrowser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b?.connected) return b;
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({
    executablePath: browserPath(),
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  });
  return browserPromise;
}

function scheduleIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(async () => {
    const pending = browserPromise;
    browserPromise = null;
    const b = await pending?.catch(() => null);
    await b?.close().catch(() => {});
  }, IDLE_CLOSE_MS);
  idleTimer.unref();
}

/** One receipt (A5 landscape, the top half of the printed A4 sheet) as a PDF buffer. */
export async function htmlToReceiptPdf(html) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    return Buffer.from(await page.pdf({ preferCSSPageSize: true, printBackground: true, pageRanges: '1' }));
  } finally {
    await page.close().catch(() => {});
    scheduleIdleClose();
  }
}

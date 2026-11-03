(function () {
  'use strict';
  const { $, $$, escapeHtml: esc, icon, toast, api } = window.ARVS;

  const cfg = JSON.parse($('#cert-config').textContent);
  const site = cfg.site;
  const MM = 96 / 25.4; // CSS px per millimetre
  const SHEET_W = 297;
  const SHEET_H = 210;
  const SAMPLE = { id: 0, salutation: 'श्री', name: 'रामप्रताप सिंह चौहान', member_no: 'नमूना', serial: null };
  const DEVANAGARI_DIGITS = '०१२३४५६७८९';

  let cal = structuredClone(cfg.calibration);
  let background = cfg.background;
  let nextSerial = cfg.nextSerial;
  let dirty = false;
  let scale = 0.5;
  let previewMember = null;
  let listItems = [];
  let certFilter = '';
  const selected = new Map();
  const signatureUrls = new Map();

  const UI_KEY = 'arvs_cert_ui';
  const ui = Object.assign({ preprint: true, signatureId: '', designSrc: 'builtin', date: '' }, JSON.parse(localStorage.getItem(UI_KEY) || '{}'));
  const saveUi = () => localStorage.setItem(UI_KEY, JSON.stringify({ preprint: ui.preprint, signatureId: ui.signatureId, designSrc: ui.designSrc }));

  const sigIds = cfg.signatures.map((s) => String(s.id));
  if (!sigIds.includes(String(ui.signatureId))) {
    ui.signatureId = String(cfg.signatures.find((s) => s.is_default)?.id ?? cfg.signatures[0]?.id ?? '');
  }
  if (!background) ui.designSrc = 'builtin';
  ui.date = new Date().toLocaleDateString('en-CA');

  const previewWrap = $('#preview-wrap');
  const previewBox = $('#preview-box');
  const previewScale = $('#preview-scale');
  const pickList = $('#pick-list');
  const printBtn = $('#btn-print');

  const printArea = document.createElement('div');
  printArea.id = 'print-area';
  document.body.append(printArea);
  window.addEventListener('afterprint', () => printArea.replaceChildren());

  /* ---------- Helpers ---------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const round = (v) => Math.round(v * 100) / 100;
  const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  function setPath(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    keys.reduce((o, k) => o[k], obj)[last] = value;
  }
  function el(tag, cls, textContent) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (textContent != null) n.textContent = textContent;
    return n;
  }
  const fill = (s) => String(s || '').replaceAll('{org_name}', site.org_name).replaceAll('{city}', site.city);
  /** Escaped text in which **double asterisks** mark bold words. */
  const rich = (s) => esc(fill(s)).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = (s) => String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const toDevanagari = (s) => s.replace(/\d/g, (d) => DEVANAGARI_DIGITS[d]);

  function formatDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    const text = `${m[3]}/${m[2]}/${m[1]}`;
    return cal.date.hindiDigits ? toDevanagari(text) : text;
  }

  function markDirty(on = true) {
    dirty = on;
    $('#dirty-badge').hidden = !on;
  }

  /* ---------- Signature images ---------- */

  /**
   * Crops a signature to its ink and makes the paper transparent, so the lowest
   * stroke sits exactly on the printed signature line whatever the upload looked like.
   */
  async function trimSignature(url) {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      return url;
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h || w * h > 16e6) return url;
    const canvas = el('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const pixels = ctx.getImageData(0, 0, w, h);
    const d = pixels.data;
    const total = w * h;

    let clear = 0;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 20) clear += 1;
      else hist[((d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000) | 0] += 1;
    }
    if (clear < total * 0.3) {
      // Photo or scan on paper: estimate the paper brightness and fade it out.
      let acc = 0;
      let paper = 255;
      for (let v = 255; v >= 0; v--) {
        acc += hist[v];
        if (acc >= (total - clear) * 0.2) {
          paper = v;
          break;
        }
      }
      const hi = paper * 0.85;
      const lo = paper * 0.55;
      for (let i = 0; i < d.length; i += 4) {
        const lum = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
        const strength = Math.min(1, Math.max(0, (hi - lum) / (hi - lo)));
        d[i + 3] = Math.round(d[i + 3] * strength);
      }
      ctx.putImageData(pixels, 0, 0);
    }

    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 64) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return url;
    const out = el('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(canvas, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  function loadSignature(id) {
    if (!id) return Promise.resolve('');
    if (!signatureUrls.has(id)) {
      signatureUrls.set(id, trimSignature(`/admin/certificates/signature/${encodeURIComponent(id)}`));
    }
    return signatureUrls.get(id);
  }

  /* ---------- Built-in design (a replica of the pre-printed sheet) ---------- */

  /**
   * Text positioned by its baseline (y, in mm). With `fit`, the font is scaled so
   * the text is exactly that many mm wide — matching the measured sheet.
   */
  function designText(html, { x, y, fit, group, align = 'center', cls = '' }) {
    const n = el('div', `cd-t${align === 'center' ? ' mid' : ''}${cls ? ` ${cls}` : ''}`);
    n.innerHTML = `<span class="ink">${html}<i class="bl"></i></span>`;
    n.style.left = `${x}mm`;
    n.dataset.baseline = y;
    if (fit) n.dataset.fit = fit;
    if (group) n.dataset.group = group;
    return n;
  }

  function buildDesign() {
    if (ui.designSrc === 'scan' && background) {
      const img = el('img', 'cd-scan');
      img.src = background;
      img.alt = '';
      img.draggable = false;
      return img;
    }
    const D = cal.design;
    const logo = esc(site.logo);
    const d = el('div', 'cert-design');
    d.innerHTML = `
      <div class="cd-band"></div>
      <div class="cd-paper"></div>
      <div class="cd-frame"></div>
      <img class="cd-watermark" src="${logo}" alt="" draggable="false">
      <div class="cd-scroll"></div>
      <span class="cd-rod top"></span><span class="cd-rod bottom"></span>
      <img class="cd-emblem" src="${logo}" alt="" draggable="false">
      <svg class="cd-art" viewBox="0 0 ${SHEET_W} ${SHEET_H}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs><linearGradient id="cd-rib" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c8262c"/><stop offset="1" stop-color="#8c1418"/></linearGradient></defs>
        <path d="M150 84 L150 95.5 L137.5 97.5 L141 90.5 L131 86.5 L142 80 Z" fill="#8e1a1e"/>
        <path d="M207.5 84 L207.5 95.5 L220 97.5 L216.5 90.5 L226.5 86.5 L215.5 80 Z" fill="#8e1a1e"/>
        <path d="M141.5 89 L150 84 L150 90.5 Z M216 89 L207.5 84 L207.5 90.5 Z" fill="#5c0c10"/>
        <path d="M140 74 Q178.5 62.6 217 74 L217 89.3 Q178.5 78.1 140 89.3 Z" fill="url(#cd-rib)"/>
        <line x1="126.4" y1="106.8" x2="265.7" y2="106.8"/>
        <line x1="92.5" y1="116.3" x2="265.7" y2="116.3"/>
        <line x1="212.2" y1="177.6" x2="254.3" y2="177.6"/>
      </svg>`;

    const texts = [
      designText(esc(site.org_name), { x: 179.9, y: 40, fit: 156.3, cls: 'cd-title' }),
      designText(esc(D.reg_line), { x: 178.7, y: 50.3, fit: 38.6, cls: 'cd-small' }),
      designText(esc(D.trust_line), { x: 178.75, y: 54, fit: 69, cls: 'cd-small latin' }),
      designText(esc(D.address), { x: 179, y: 59.8, fit: 100.3, cls: 'cd-addr' }),
      designText('क्रम संख्या :', { x: 225.7, y: 71.5, fit: 17.6, align: 'left', cls: 'cd-label' }),
      designText(esc(D.ribbon), { x: 177.9, y: 81.6, fit: 59.7, cls: 'cd-ribbon-text' }),
      designText('श्री. / श्रीमती. / कु.', { x: 92.5, y: 111.2, fit: 32, align: 'left', cls: 'cd-label' }),
      designText('दिनांक :', { x: 113.2, y: 184, fit: 12.9, align: 'left', cls: 'cd-label' }),
      designText('अध्यक्ष / सचिव', { x: 219, y: 183.9, fit: 28.1, align: 'left', cls: 'cd-label' }),
      designText(esc(D.duties_title), { x: 58.2, y: 80.6, fit: 15.8, cls: 'cd-gold' }),
      designText(esc(D.duties_head), { x: 58.25, y: 89.5, fit: 45.5, cls: 'cd-gold' }),
    ];
    lines(D.body).forEach((line, i) => texts.push(designText(rich(line), { x: 178.7, y: 129.3 + i * 9.85, fit: 161.9, group: 'body', cls: 'cd-body' })));
    lines(D.duties).forEach((line, i) => texts.push(designText(esc(line), { x: 57.6, y: 98.1 + i * 6.67, fit: 46.4, group: 'duties', cls: 'cd-duty' })));
    d.append(...texts);
    return d;
  }

  /* ---------- Sheet construction ---------- */

  function inkText(node, sizePt) {
    node.style.fontFamily = `"${cal.name.font}", "Tiro Devanagari Hindi", serif`;
    node.style.fontWeight = cal.name.weight;
    node.style.color = cal.name.color;
    node.style.fontSize = `${sizePt}pt`;
  }

  /** A printed text field; the zero-size marker inside is used to find the text baseline. */
  function textField(key, text, sizePt) {
    const f = el('div', `f f-text f-${key}`);
    f.dataset.key = key;
    const t = el('span', 'ink', text);
    t.append(el('i', 'bl'));
    f.append(t);
    inkText(f, sizePt);
    return f;
  }

  /** Places a field so its baseline (text) or bottom edge (signature) lands on the calibrated Y. */
  function positionField(f) {
    const c = cal[f.dataset.key];
    const anchorY = f.dataset.key === 'signature' ? c.y - c.height : c.y;
    f.style.left = `${round(c.x + cal.offsetX)}mm`;
    f.style.top = `calc(${round(anchorY + cal.offsetY)}mm - ${Number(f.dataset.lift) || 0}px)`;
  }

  function nameText(m) {
    return `${cal.name.salutation && m.salutation ? `${m.salutation} ` : ''}${m.name}`;
  }

  function buildSheet(m, { test = false, grid = false, forPrint = false } = {}) {
    const sheet = el('div', `sheet${ui.preprint ? ' preprint' : ''}`);
    if (!(forPrint && ui.preprint)) sheet.append(buildDesign());

    const n = textField('name', nameText(m), cal.name.fontSize);
    n.style.width = `${cal.name.width}mm`;
    n.style.textAlign = cal.name.align;
    sheet.append(n);

    let sig;
    const sigUrl = ui.signatureId && signatureUrls.get(ui.signatureId);
    if (typeof sigUrl === 'string' && sigUrl) {
      sig = el('img', 'f f-sig');
      sig.src = sigUrl;
      sig.alt = '';
      sig.draggable = false;
    } else {
      sig = el('div', 'f f-sig empty');
    }
    sig.dataset.key = 'signature';
    sig.style.width = `${cal.signature.width}mm`;
    sig.style.height = `${cal.signature.height}mm`;
    sheet.append(sig);

    if (cal.date.enabled) sheet.append(textField('date', formatDate(ui.date), cal.date.fontSize));
    if (cal.serial.enabled) {
      const serial = String(m.serial ?? nextSerial);
      sheet.append(textField('serial', `${cal.serial.prefix || ''}${cal.date.hindiDigits ? toDevanagari(serial) : serial}`, cal.serial.fontSize));
    }

    $$('.f', sheet).forEach(positionField);
    if (test || grid) sheet.append(buildCalibrationOverlay({ grid }));
    return sheet;
  }

  /**
   * Rulers or a full millimetre grid plus a marker for every field, so a test
   * print can be laid over (or printed on) a pre-printed sheet and read off directly.
   */
  function buildCalibrationOverlay({ grid = false } = {}) {
    const parts = [];
    if (grid) {
      for (let x = 5; x < SHEET_W; x += 5) parts.push(`<line class="${x % 10 ? 'g5' : 'g10'}" x1="${x}" y1="0" x2="${x}" y2="${SHEET_H}"/>`);
      for (let y = 5; y < SHEET_H; y += 5) parts.push(`<line class="${y % 10 ? 'g5' : 'g10'}" x1="0" y1="${y}" x2="${SHEET_W}" y2="${y}"/>`);
      for (let x = 10; x < SHEET_W; x += 10) {
        for (const y of [3.2, 103.6, 208]) parts.push(`<text class="gl" x="${x + 0.4}" y="${y}">${x}</text>`);
      }
      for (let y = 10; y < SHEET_H; y += 10) {
        for (const x of [1, 100.4, 200.4, 289]) parts.push(`<text class="gl" x="${x}" y="${y - 0.5}">${y}</text>`);
      }
    } else {
      for (let x = 0; x <= SHEET_W; x += 1) {
        const len = x % 10 === 0 ? 5 : x % 5 === 0 ? 3 : 1.5;
        parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${len}"/>`);
        if (x % 10 === 0 && x > 0 && x < SHEET_W) parts.push(`<text x="${x}" y="8" text-anchor="middle">${x}</text>`);
      }
      for (let y = 0; y <= SHEET_H; y += 1) {
        const len = y % 10 === 0 ? 5 : y % 5 === 0 ? 3 : 1.5;
        parts.push(`<line x1="0" y1="${y}" x2="${len}" y2="${y}"/>`);
        if (y % 10 === 0 && y > 0 && y < SHEET_H) parts.push(`<text x="6.5" y="${y + 0.9}">${y}</text>`);
      }
      parts.push('<line x1="143.5" y1="105" x2="153.5" y2="105"/><line x1="148.5" y1="100" x2="148.5" y2="110"/><circle cx="148.5" cy="105" r="2" fill="none"/>');
    }

    const marks = [['नाम', cal.name, cal.name.width]];
    if (cal.date.enabled) marks.push(['दिनांक', cal.date, 30]);
    if (cal.serial.enabled) marks.push(['क्रम संख्या', cal.serial, 22]);
    for (const [label, c, w] of marks) {
      parts.push(
        `<line class="mark" x1="${c.x}" y1="${c.y}" x2="${round(c.x + w)}" y2="${c.y}"/>`,
        `<line class="mark" x1="${c.x}" y1="${c.y - 2}" x2="${c.x}" y2="${c.y + 2}"/>`,
        `<text class="ml" x="${c.x}" y="${round(c.y + 3.4)}">${esc(label)} — आधार-रेखा X ${c.x}, Y ${c.y}</text>`
      );
    }
    const s = cal.signature;
    parts.push(
      `<rect x="${s.x}" y="${round(s.y - s.height)}" width="${s.width}" height="${s.height}" fill="none" stroke-dasharray="1.2 0.8"/>`,
      `<line class="mark" x1="${s.x}" y1="${s.y}" x2="${round(s.x + s.width)}" y2="${s.y}"/>`,
      `<text class="ml" x="${s.x}" y="${round(s.y + 3.4)}">हस्ताक्षर — नीचे की रेखा Y ${s.y}</text>`,
      `<text class="big" x="148.5" y="${SHEET_H - 9}" text-anchor="middle">${grid ? 'ग्रिड' : 'परीक्षण'} प्रिंट — प्रिंटर ऑफ़सेट X ${cal.offsetX} mm, Y ${cal.offsetY} mm • A4 लैंडस्केप, Margins: None, Scale 100%</text>`
    );

    const wrap = el('div');
    wrap.innerHTML = `<svg class="calib-svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}" xmlns="http://www.w3.org/2000/svg">
      <style>line,rect,circle{stroke:#d40000;stroke-width:.18}line.g5{stroke:#7a9cc6;stroke-width:.08}line.g10{stroke:#d40000;stroke-width:.12}line.mark{stroke:#0033cc;stroke-width:.3}text{font:2.4px sans-serif;fill:#d40000}text.gl{font-size:2px}text.ml{font-size:2.2px;fill:#0033cc}text.big{font-size:3px;font-weight:bold}</style>
      <g transform="translate(${cal.offsetX} ${cal.offsetY})">${parts.join('')}</g></svg>`;
    return wrap.firstElementChild;
  }

  /* ---------- Measuring (needs the sheet in the document and fonts loaded) ---------- */

  function zoomOf(sheet) {
    return sheet.offsetWidth ? sheet.getBoundingClientRect().width / sheet.offsetWidth : 1;
  }

  function fitName(sheet, zoom) {
    const n = $('.f-name', sheet);
    const t = n && $('.ink', n);
    if (!t) return;
    const base = cal.name.fontSize;
    let size = base;
    n.style.fontSize = `${size}pt`;
    const limit = n.clientWidth;
    if (!limit) return;
    while (t.getBoundingClientRect().width / zoom > limit + 0.5 && size > base * 0.5) {
      size -= 0.5;
      n.style.fontSize = `${size}pt`;
    }
  }

  function fitDesignText(sheet, zoom) {
    const groups = new Map();
    $$('.cd-t[data-fit]', sheet).forEach((n) => {
      const key = n.dataset.group || n;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    });
    for (const nodes of groups.values()) {
      const widest = Math.max(...nodes.map((n) => $('.ink', n).getBoundingClientRect().width / zoom));
      if (!widest) continue;
      const ratio = (Number(nodes[0].dataset.fit) * MM) / widest;
      const sizes = nodes.map((n) => parseFloat(getComputedStyle(n).fontSize));
      nodes.forEach((n, i) => (n.style.fontSize = `${round(sizes[i] * ratio)}px`));
    }
  }

  /** Distance from the top of the box to the text baseline, in CSS px. */
  function baselineLift(node, zoom) {
    const mark = $('.bl', node);
    return mark ? round((mark.getBoundingClientRect().top - node.getBoundingClientRect().top) / zoom) : 0;
  }

  function alignSheet(sheet) {
    const zoom = zoomOf(sheet) || 1;
    fitDesignText(sheet, zoom);
    $$('.cd-t', sheet).forEach((n) => {
      n.style.top = `calc(${n.dataset.baseline}mm - ${baselineLift(n, zoom)}px)`;
    });
    fitName(sheet, zoom);
    $$('.f', sheet).forEach((f) => {
      if (f.classList.contains('f-text')) {
        f.dataset.lift = baselineLift(f, zoom);
        f.style.setProperty('--baseline', `${f.dataset.lift}px`);
      }
      positionField(f);
    });
  }

  /* ---------- Preview ---------- */

  function layoutPreview() {
    const avail = previewWrap.clientWidth - 32;
    if (avail <= 0) return;
    scale = Math.min(1.2, avail / (SHEET_W * MM));
    previewScale.style.transform = `scale(${scale})`;
    previewBox.style.width = `${SHEET_W * MM * scale}px`;
    previewBox.style.height = `${SHEET_H * MM * scale}px`;
  }

  function renderPreview() {
    const m = previewMember || SAMPLE;
    const sheet = buildSheet(m);
    previewScale.replaceChildren(sheet);
    layoutPreview();
    alignSheet(sheet);
    $('#preview-who').textContent = previewMember ? `${m.name} (${m.member_no || ''})` : 'नमूना नाम दिखाया जा रहा है';
    const note = $('#mode-note');
    const extras = [cal.date.enabled && 'दिनांक', cal.serial.enabled && 'क्रम संख्या'].filter(Boolean);
    note.className = `mode-note${ui.preprint ? '' : ' full'}`;
    note.innerHTML = ui.preprint
      ? `${icon('info')} <b>प्री-प्रिंटेड पेपर मोड:</b> केवल सदस्य का नाम, अध्यक्ष / सचिव के हस्ताक्षर${extras.length ? ` तथा ${extras.join(' व ')}` : ''} छपेंगे — शीट का डिज़ाइन नहीं छपेगा।`
      : `${icon('alert')} <b>पूर्ण डिज़ाइन मोड:</b> सादे कागज़ पर पूरा प्रमाण पत्र (बॉर्डर, लोगो व पाठ सहित) छपेगा। प्रिंट सेटिंग में "Background graphics" चालू करें।`;
    $('#date-opt').hidden = !cal.date.enabled;
  }

  new ResizeObserver(layoutPreview).observe(previewWrap);

  /* Drag fields directly on the preview */
  previewScale.addEventListener('pointerdown', (e) => {
    const f = e.target.closest('.f');
    if (!f) return;
    e.preventDefault();
    const target = cal[f.dataset.key];
    const start = { x: e.clientX, y: e.clientY, cx: target.x, cy: target.y };
    try {
      f.setPointerCapture(e.pointerId);
    } catch {
      // Capture is best-effort; dragging still works without it.
    }
    f.classList.add('dragging');
    const move = (ev) => {
      target.x = Math.min(SHEET_W, Math.max(0, Math.round((start.cx + (ev.clientX - start.x) / scale / MM) * 2) / 2));
      target.y = Math.min(SHEET_H, Math.max(0, Math.round((start.cy + (ev.clientY - start.y) / scale / MM) * 2) / 2));
      positionField(f);
      syncControls();
    };
    const up = () => {
      f.removeEventListener('pointermove', move);
      f.removeEventListener('pointerup', up);
      f.removeEventListener('pointercancel', up);
      f.classList.remove('dragging');
      if (target.x !== start.cx || target.y !== start.cy) markDirty();
      renderPreview();
    };
    f.addEventListener('pointermove', move);
    f.addEventListener('pointerup', up);
    f.addEventListener('pointercancel', up);
  });

  /* ---------- Calibration controls ---------- */

  function syncControls() {
    $$('[data-path]').forEach((input) => {
      const v = getPath(cal, input.dataset.path);
      if (input.type === 'checkbox') input.checked = Boolean(v);
      else if (document.activeElement !== input) input.value = v ?? '';
    });
  }

  function onControl(e) {
    const input = e.target.closest('[data-path]');
    if (!input) return;
    const path = input.dataset.path;
    let v;
    if (input.type === 'checkbox') v = input.checked;
    else if (input.type === 'range' || input.type === 'number') {
      v = Number.parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      v = round(v);
    } else if (path === 'name.weight') v = Number(input.value);
    else v = input.value;
    if (getPath(cal, path) === v) return;
    setPath(cal, path, v);
    $$(`[data-path="${path}"]`).forEach((o) => {
      if (o !== input && o.type !== 'checkbox') o.value = v;
    });
    markDirty();
    renderPreview();
  }
  document.addEventListener('input', onControl);
  document.addEventListener('change', onControl);

  $$('[data-nudge]').forEach((b) =>
    b.addEventListener('click', () => {
      const [path, delta] = b.dataset.nudge.split(':');
      setPath(cal, path, round(getPath(cal, path) + Number(delta)));
      syncControls();
      markDirty();
      renderPreview();
    })
  );

  $$('.cal-tabs button').forEach((b) =>
    b.addEventListener('click', () => {
      $$('.cal-tabs button').forEach((x) => x.classList.toggle('active', x === b));
      $$('.cal-pane').forEach((p) => p.classList.toggle('active', p.id === b.dataset.tab));
    })
  );

  $('#btn-save').addEventListener('click', async () => {
    const data = await api('/admin/certificates/calibration', { method: 'POST', json: { calibration: cal } });
    if (!data.ok) return toast(data.error, 'error');
    cal = data.calibration;
    markDirty(false);
    syncControls();
    renderPreview();
    toast('कैलिब्रेशन सहेजा गया।', 'success');
  });

  $('#btn-reset').addEventListener('click', async (e) => {
    if (!window.confirm(e.currentTarget.dataset.confirmJs)) return;
    const data = await api('/admin/certificates/calibration/reset', { method: 'POST', json: {} });
    if (!data.ok) return toast(data.error, 'error');
    cal = data.calibration;
    markDirty(false);
    syncControls();
    renderPreview();
    toast('डिफ़ॉल्ट मान लागू किए गए।', 'success');
  });

  /* Serial counter */
  const serialInput = $('#next-serial');
  function setNextSerial(n) {
    nextSerial = n;
    serialInput.value = n;
  }
  $('#btn-serial').addEventListener('click', async () => {
    const data = await api('/admin/certificates/serial', { method: 'POST', json: { next: serialInput.value } });
    if (!data.ok) return toast(data.error, 'error');
    setNextSerial(data.nextSerial);
    renderPreview();
    toast(`अगला क्रमांक ${data.nextSerial} सेट किया गया।`, 'success');
  });

  /* Scanned sheet background */
  const bgRemove = $('#bg-remove');
  const srcScan = $('#src-scan');
  function syncBackgroundUi() {
    bgRemove.hidden = !background;
    srcScan.disabled = !background;
    $$('input[name="design-src"]').forEach((r) => (r.checked = r.value === ui.designSrc));
  }
  $$('input[name="design-src"]').forEach((r) =>
    r.addEventListener('change', () => {
      ui.designSrc = r.value;
      saveUi();
      renderPreview();
    })
  );
  $('#bg-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('background', file);
    toast('स्कैन अपलोड हो रहा है…');
    const data = await api('/admin/certificates/background', { method: 'POST', body: fd });
    e.target.value = '';
    if (!data.ok) return toast(data.error, 'error');
    background = data.background;
    ui.designSrc = 'scan';
    saveUi();
    syncBackgroundUi();
    renderPreview();
    toast('स्कैन अपलोड हुआ — पूर्वावलोकन में अब आपकी शीट दिख रही है।', 'success');
  });
  bgRemove.addEventListener('click', async () => {
    if (!window.confirm('स्कैन की गई शीट हटाएँ?')) return;
    const fd = new FormData();
    fd.append('remove', '1');
    const data = await api('/admin/certificates/background', { method: 'POST', body: fd });
    if (!data.ok) return toast(data.error, 'error');
    background = null;
    ui.designSrc = 'builtin';
    saveUi();
    syncBackgroundUi();
    renderPreview();
  });

  /* Print options */
  const preprintToggle = $('#opt-preprint');
  preprintToggle.checked = ui.preprint;
  preprintToggle.addEventListener('change', () => {
    ui.preprint = preprintToggle.checked;
    saveUi();
    renderPreview();
  });
  const sigSelect = $('#opt-signature');
  sigSelect.value = ui.signatureId;
  sigSelect.addEventListener('change', async () => {
    ui.signatureId = sigSelect.value;
    saveUi();
    renderPreview();
    await useSignature(ui.signatureId);
  });
  const dateInput = $('#opt-date');
  dateInput.value = ui.date;
  dateInput.addEventListener('change', () => {
    ui.date = dateInput.value;
    renderPreview();
  });

  async function useSignature(id) {
    if (!id) return;
    const url = await loadSignature(id);
    signatureUrls.set(id, url);
    if (ui.signatureId === id) renderPreview();
  }

  /* ---------- Member picker ---------- */

  const byId = (id) => listItems.find((m) => m.id === Number(id)) || selected.get(Number(id));

  function statusBadge(m) {
    if (!m.printed) return '<span class="pstat no" title="इस सदस्य का प्रमाण पत्र अभी नहीं छपा है">नहीं छपा</span>';
    const times = m.printed > 1 ? ` ×${m.printed}` : '';
    return `<span class="pstat yes" title="${m.printed} बार छपा • अंतिम प्रिंट: ${esc(m.printed_at)}">${icon('check')} छपा${times}<small>${esc(m.printed_at)}</small></span>`;
  }

  function pickRow(m) {
    const meta = [m.member_no, m.category_label + (m.designation ? ` — ${m.designation}` : ''), m.mandal].filter(Boolean).map(esc).join(' · ');
    return `<label class="pick${previewMember?.id === m.id ? ' previewing' : ''}${m.printed ? ' is-printed' : ''}" data-id="${m.id}">
      <input type="checkbox"${selected.has(m.id) ? ' checked' : ''}>
      <span class="pick-main"><b>${esc(m.salutation ? `${m.salutation} ` : '')}${esc(m.name)}</b><span class="pick-meta">${meta}</span></span>
      ${statusBadge(m)}
      <button type="button" class="btn btn-outline btn-icon btn-sm" data-preview title="पूर्वावलोकन">${icon('eye')}</button>
    </label>`;
  }

  function renderList() {
    pickList.innerHTML = listItems.length
      ? listItems.map(pickRow).join('')
      : `<div class="pick-empty">${icon('search')}<br>कोई सदस्य नहीं मिला।</div>`;
  }

  function markPreviewRow() {
    $$('.pick', pickList).forEach((r) => r.classList.toggle('previewing', Number(r.dataset.id) === previewMember?.id));
  }

  const pickAll = $('#pick-all');

  function updateSelection() {
    const n = selected.size;
    $('#sel-count').textContent = n;
    printBtn.disabled = n === 0;
    $('#print-label').textContent = n ? `${n} प्रमाण पत्र प्रिंट करें` : 'प्रिंट करें';
    $$('[data-needs-selection]').forEach((b) => (b.disabled = n === 0));
    $('#sel-chips').innerHTML = [...selected.values()]
      .map((m) => `<button type="button" data-unselect="${m.id}" title="चयन से हटाएँ">${esc(m.name)} ${icon('x')}</button>`)
      .join('');
    $$('.pick', pickList).forEach((r) => {
      $('input', r).checked = selected.has(Number(r.dataset.id));
    });
    const shown = listItems.filter((m) => selected.has(m.id)).length;
    pickAll.checked = listItems.length > 0 && shown === listItems.length;
    pickAll.indeterminate = shown > 0 && shown < listItems.length;
    $('#pick-all-label').textContent = listItems.length ? `सभी ${listItems.length} चुनें` : 'सभी चुनें';
  }

  pickList.addEventListener('change', (e) => {
    const row = e.target.closest('.pick');
    if (!row) return;
    e.stopPropagation();
    const m = byId(row.dataset.id);
    if (!m) return;
    if (e.target.checked) {
      selected.set(m.id, m);
      previewMember = m;
      markPreviewRow();
      renderPreview();
    } else {
      selected.delete(m.id);
    }
    updateSelection();
  });

  pickList.addEventListener('click', (e) => {
    const b = e.target.closest('[data-preview]');
    if (!b) return;
    e.preventDefault();
    previewMember = byId(b.closest('.pick').dataset.id);
    markPreviewRow();
    renderPreview();
  });

  $('#sel-chips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unselect]');
    if (!b) return;
    selected.delete(Number(b.dataset.unselect));
    updateSelection();
  });

  pickAll.addEventListener('change', (e) => {
    e.stopPropagation();
    if (pickAll.checked) listItems.forEach((m) => selected.set(m.id, m));
    else listItems.forEach((m) => selected.delete(m.id));
    updateSelection();
  });
  $('#pick-none').addEventListener('click', () => {
    selected.clear();
    updateSelection();
  });

  $$('#pick-cert button').forEach((b) =>
    b.addEventListener('click', () => {
      certFilter = b.dataset.cert;
      $$('#pick-cert button').forEach((x) => x.classList.toggle('active', x === b));
      loadMembers();
    })
  );

  let loadSeq = 0;
  async function loadMembers(extra = {}) {
    const params = new URLSearchParams({
      q: $('#pick-q').value.trim(),
      category: $('#pick-category').value,
      mandal: $('#pick-mandal').value,
      cert: certFilter,
      ...extra,
    });
    const seq = ++loadSeq;
    const data = await api(`/admin/certificates/members?${params}`);
    if (seq !== loadSeq) return null;
    if (!data.ok) {
      toast(data.error, 'error');
      return null;
    }
    listItems = data.items;
    for (const m of listItems) if (selected.has(m.id)) selected.set(m.id, m);
    renderList();
    updateSelection();
    $('#cnt-all').textContent = data.counts.total;
    $('#cnt-unprinted').textContent = data.counts.unprinted;
    $('#cnt-printed').textContent = data.counts.printed;
    $('#pick-info').textContent = data.total > listItems.length ? `पहले ${listItems.length} / ${data.total} दिखाए गए` : `${listItems.length} सदस्य`;
    return data;
  }

  let searchTimer;
  $('#pick-q').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadMembers(), 250);
  });
  ['#pick-category', '#pick-mandal'].forEach((s) =>
    $(s).addEventListener('change', (e) => {
      e.stopPropagation();
      loadMembers();
    })
  );

  async function setPrinted(ids, printed) {
    const data = await api(`/admin/certificates/${printed ? 'issue' : 'unmark'}`, { method: 'POST', json: { ids } });
    if (!data.ok) {
      toast(data.error, 'error');
      return false;
    }
    toast(`${data.count} सदस्य "${printed ? 'छपा' : 'नहीं छपा'}" चिह्नित किए गए।`, 'success');
    return true;
  }

  $('#mark-printed').addEventListener('click', async () => {
    const ids = [...selected.keys()];
    if (!ids.length || !window.confirm(`चयनित ${ids.length} सदस्यों को "प्रमाण पत्र छपा" चिह्नित करें?`)) return;
    if (await setPrinted(ids, true)) {
      selected.clear();
      loadMembers();
    }
  });
  $('#mark-unprinted').addEventListener('click', async () => {
    const ids = [...selected.keys()];
    if (!ids.length || !window.confirm(`चयनित ${ids.length} सदस्यों का "छपा" चिह्न हटाएँ? (प्रिंट गिनती शून्य हो जाएगी)`)) return;
    if (await setPrinted(ids, false)) loadMembers();
  });

  /* ---------- Printing ---------- */

  async function ensureFonts() {
    const specs = [
      `${cal.name.weight} 20px "${cal.name.font}"`,
      '20px "Rozha One"',
      '20px "Tiro Devanagari Hindi"',
      '400 20px "Mukta"',
      '600 20px "Mukta"',
      '700 20px "Mukta"',
      '800 20px "Mukta"',
    ];
    await Promise.race([Promise.all(specs.map((s) => document.fonts.load(s, 'अवध राजपूत 0123').catch(() => null))), sleep(4000)]);
    await document.fonts.ready;
  }

  function imagesLoaded(root) {
    const pending = $$('img', root)
      .filter((img) => !img.complete)
      .map((img) => new Promise((r) => {
        img.addEventListener('load', r, { once: true });
        img.addEventListener('error', r, { once: true });
      }));
    return Promise.race([Promise.all(pending), sleep(8000)]);
  }

  async function printSheets(members, opts = {}) {
    if (ui.signatureId) await useSignature(ui.signatureId);
    await ensureFonts();
    printArea.replaceChildren(...members.map((m) => buildSheet(m, { ...opts, forPrint: true })));
    await imagesLoaded(printArea);
    $$('.sheet', printArea).forEach(alignSheet);
    window.print();
  }

  $('#btn-test').addEventListener('click', () => printSheets([previewMember || SAMPLE], { test: true }));
  $('#btn-grid').addEventListener('click', () => printSheets([previewMember || SAMPLE], { grid: true }));

  printBtn.addEventListener('click', async () => {
    const ids = [...selected.keys()];
    if (!ids.length) return;
    if (dirty && !window.confirm('कैलिब्रेशन में बिना सहेजे बदलाव हैं। ये इस प्रिंट में लागू होंगे, पर सहेजे नहीं जाएँगे। जारी रखें?')) return;
    if (!ui.signatureId && !window.confirm('कोई हस्ताक्षर नहीं चुना गया है। क्या बिना हस्ताक्षर के प्रिंट करें?')) return;
    if (cal.date.enabled && !ui.date && !window.confirm('दिनांक नहीं चुना गया है। क्या बिना दिनांक के प्रिंट करें?')) return;
    const already = ids.filter((id) => selected.get(id)?.printed).length;
    if (already && !window.confirm(`चयनित में से ${already} सदस्यों का प्रमाण पत्र पहले ही छप चुका है। क्या उन्हें दोबारा छापें?`)) return;

    printBtn.disabled = true;
    try {
      const data = await api('/admin/certificates/prepare', { method: 'POST', json: { ids, assignSerial: Boolean(cal.serial.enabled) } });
      if (!data.ok) return toast(data.error, 'error');
      setNextSerial(data.nextSerial);
      await printSheets(data.items);
      await sleep(400);
      const ok = window.confirm(
        `क्या सभी ${data.items.length} प्रमाण पत्र सही छप गए?\n\n"OK" — इन सदस्यों को "प्रमाण पत्र छपा" चिह्नित करें।\n"Cancel" — प्रिंट रद्द हुआ या गलत छपा (चिह्नित नहीं होंगे)।`
      );
      if (ok && (await setPrinted(data.items.map((m) => m.id), true))) selected.clear();
      loadMembers();
    } finally {
      updateSelection();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  /* ---------- Boot ---------- */

  async function init() {
    setNextSerial(nextSerial);
    syncControls();
    syncBackgroundUi();
    renderPreview();
    useSignature(ui.signatureId);
    const query = new URLSearchParams(location.search);
    const preselect = query.get('ids');
    if (query.get('all') === '1') {
      $('#pick-q').value = query.get('q') || '';
      $('#pick-category').value = query.get('category') || '';
      $('#pick-mandal').value = query.get('mandal') || '';
      certFilter = query.get('cert') || '';
      $$('#pick-cert button').forEach((x) => x.classList.toggle('active', x.dataset.cert === certFilter));
    }
    if (preselect || query.get('all') === '1') {
      const data = await loadMembers(preselect ? { ids: preselect } : { committee: query.get('committee') || '' });
      if (data?.items.length) {
        data.items.forEach((m) => selected.set(m.id, m));
        previewMember = data.items[0];
        updateSelection();
        markPreviewRow();
        renderPreview();
      }
    } else {
      await loadMembers();
    }
    await ensureFonts();
    renderPreview();
  }
  init();
})();

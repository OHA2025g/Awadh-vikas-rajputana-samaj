(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function icon(name, cls = '') {
    return `<svg class="ic ${cls}" aria-hidden="true"><use href="/img/icons.svg#${name}"></use></svg>`;
  }

  let toastTimer;
  function toast(msg, type = '') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
  }

  async function api(url, { method = 'GET', body, json } = {}) {
    const headers = { Accept: 'application/json' };
    let payload = body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const csrf = $('meta[name="csrf-token"]');
    if (csrf) headers['X-CSRF-Token'] = csrf.content;
    let res;
    try {
      res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    } catch {
      return { ok: false, error: 'नेटवर्क त्रुटि — कृपया कनेक्शन जाँचें।' };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: `सर्वर से अमान्य उत्तर मिला (${res.status})।` };
    }
    if (!res.ok && data.ok !== false) data.ok = false;
    if (!res.ok && !data.error) data.error = `त्रुटि (${res.status})`;
    return data;
  }

  window.ARVS = { $, $$, escapeHtml, icon, toast, api };

  /* Sidebar (mobile) */
  const sidebar = $('#sidebar');
  $$('[data-sidebar-toggle]').forEach((b) => b.addEventListener('click', () => sidebar?.classList.toggle('open')));
  document.addEventListener('click', (e) => {
    if (sidebar?.classList.contains('open') && !e.target.closest('#sidebar, [data-sidebar-toggle]')) sidebar.classList.remove('open');
  });

  /* Confirmation prompts */
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const submitter = e.submitter;
    const msg = submitter?.dataset.confirm || form.dataset.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-confirm]');
    if (a && !window.confirm(a.dataset.confirm)) e.preventDefault();
  });

  /* Auto-submit filters */
  $$('[data-autosubmit]').forEach((el) => el.addEventListener('change', () => el.form?.requestSubmit()));

  /* Header and signature dates on the admin member form stay in step. */
  const formDates = $$('[data-form-date]');
  if (formDates.length > 1) {
    const syncDates = (from) => formDates.forEach((el) => {
      if (el !== from) el.value = from.value;
    });
    formDates.forEach((el) => el.addEventListener('input', () => syncDates(el)));
  }

  /* सहयोग: entries chosen for receipt printing (checkboxes live in the table, outside the form) */
  const receiptForm = $('#receipt-form');
  if (receiptForm) {
    const boxes = () => $$('input[form="receipt-form"][name="ids"]');
    const all = $('[data-receipt-all]');
    const printBtn = $('[data-receipt-print]', receiptForm);
    const count = $('[data-receipt-count]', receiptForm);
    const update = () => {
      const n = boxes().filter((b) => b.checked).length;
      printBtn.disabled = n === 0;
      count.textContent = n;
      if (all) {
        all.checked = n > 0 && n === boxes().length;
        all.indeterminate = n > 0 && n < boxes().length;
      }
    };
    all?.addEventListener('change', () => {
      boxes().forEach((b) => (b.checked = all.checked));
      update();
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches?.('input[form="receipt-form"][name="ids"]')) update();
    });
    update();
  }

  /* Bulk selection */
  $$('[data-bulk]').forEach((form) => {
    const all = $('[data-select-all]', form);
    const boxes = () => $$('input[name="ids"]', form);
    const countEl = $('[data-selected-count]', form);
    const actions = $$('[data-bulk-action]', form);
    const allMatching = $('input[name="all_matching"]', form);
    const banner = $('[data-all-banner]', form);
    function update() {
      const n = boxes().filter((b) => b.checked).length;
      const wholePage = n > 0 && n === boxes().length;
      if (allMatching && !wholePage) allMatching.value = '0';
      const matching = allMatching?.value === '1';
      if (countEl) countEl.textContent = matching ? form.dataset.total : n;
      actions.forEach((a) => (a.disabled = n === 0));
      if (all) {
        all.checked = wholePage;
        all.indeterminate = n > 0 && !wholePage;
      }
      if (banner) {
        banner.hidden = !wholePage;
        $('[data-banner-page]', banner).hidden = matching;
        $('[data-banner-all]', banner).hidden = !matching;
      }
    }
    $('[data-select-matching]', form)?.addEventListener('click', () => {
      allMatching.value = '1';
      update();
    });
    $('[data-clear-matching]', form)?.addEventListener('click', () => {
      boxes().forEach((b) => (b.checked = false));
      update();
    });
    all?.addEventListener('change', () => {
      boxes().forEach((b) => (b.checked = all.checked));
      update();
    });
    form.addEventListener('change', (e) => e.target.name === 'ids' && update());
    update();

    const actionSelect = $('[data-bulk-select]', form);
    actionSelect?.addEventListener('change', () => {
      $$('[data-for-action]', form).forEach((s) => (s.hidden = s.dataset.forAction !== actionSelect.value));
    });
    $('[data-print-selected]', form)?.addEventListener('click', () => {
      if (allMatching?.value === '1') {
        window.location.href = `/admin/certificates?all=1${form.dataset.qs ? `&${form.dataset.qs}` : ''}`;
        return;
      }
      const ids = boxes().filter((b) => b.checked).map((b) => b.value);
      if (ids.length) window.location.href = `/admin/certificates?ids=${ids.join(',')}`;
    });
  });

  /* Image previews for file inputs */
  $$('input[type="file"][data-preview]').forEach((input) => {
    input.addEventListener('change', () => {
      const img = $(input.dataset.preview);
      const file = input.files[0];
      if (img && file) {
        img.src = URL.createObjectURL(file);
        img.hidden = false;
      }
    });
  });

  /* Modals */
  $$('[data-open-modal]').forEach((b) =>
    b.addEventListener('click', () => $(b.dataset.openModal)?.classList.add('open'))
  );
  $$('[data-close-modal]').forEach((b) => b.addEventListener('click', () => b.closest('.modal')?.classList.remove('open')));
  $$('.modal').forEach((m) => m.addEventListener('click', (e) => e.target === m && m.classList.remove('open')));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $$('.modal.open').forEach((m) => m.classList.remove('open'));
  });

  /* Lightweight rich-text editor (output is sanitized again on the server) */
  const RTE_BUTTONS = [
    ['bold', '<b>B</b>', 'बोल्ड'],
    ['italic', '<i>I</i>', 'इटैलिक'],
    ['underline', '<u>U</u>', 'अंडरलाइन'],
    ['h3', 'H', 'उपशीर्षक'],
    ['p', '¶', 'सामान्य पैराग्राफ'],
    ['insertUnorderedList', '•', 'बुलेट सूची'],
    ['insertOrderedList', '1.', 'क्रमांकित सूची'],
    ['blockquote', '❝', 'उद्धरण'],
    ['createLink', icon('link'), 'लिंक जोड़ें'],
    ['unlink', '⨯🔗', 'लिंक हटाएँ'],
    ['removeFormat', '⌫', 'फ़ॉर्मेटिंग हटाएँ'],
  ];

  $$('textarea[data-rte]').forEach((ta) => {
    const wrap = document.createElement('div');
    wrap.className = 'rte';
    const bar = document.createElement('div');
    bar.className = 'rte-bar';
    bar.innerHTML = RTE_BUTTONS.map(([cmd, label, title]) => `<button type="button" data-cmd="${cmd}" title="${title}">${label}</button>`).join('');
    const area = document.createElement('div');
    area.className = 'rte-area';
    area.contentEditable = 'true';
    area.dataset.placeholder = ta.placeholder || 'यहाँ लिखें…';
    area.innerHTML = ta.value;
    wrap.append(bar, area);
    ta.hidden = true;
    ta.after(wrap);

    const sync = () => {
      ta.value = area.innerText.trim() ? area.innerHTML : '';
    };
    area.addEventListener('input', sync);
    ta.form?.addEventListener('submit', sync);

    bar.addEventListener('mousedown', (e) => e.preventDefault());
    bar.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      area.focus();
      if (cmd === 'h3' || cmd === 'p' || cmd === 'blockquote') {
        document.execCommand('formatBlock', false, cmd);
      } else if (cmd === 'createLink') {
        const url = window.prompt('लिंक (https://…)', 'https://');
        if (url && /^(https?:|mailto:|tel:)/i.test(url)) document.execCommand('createLink', false, url);
      } else {
        document.execCommand(cmd, false, null);
      }
      sync();
    });

    area.addEventListener('paste', (e) => {
      e.preventDefault();
      const textData = e.clipboardData.getData('text/plain');
      document.execCommand('insertText', false, textData);
    });
  });

  /* Copy-to-clipboard buttons */
  $$('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        toast('कॉपी किया गया');
      } catch {
        toast('कॉपी नहीं हो सका');
      }
    })
  );

  /* Drawn signatures (signatures page) — SignaturePad loads after this file */
  document.addEventListener('DOMContentLoaded', () => {
    const canvas = $('#sig-canvas');
    if (!canvas || !window.SignaturePad) return;
    const pad = new window.SignaturePad(canvas, { color: $('#sig-color')?.value || '#0b1d5b', maxWidth: 3.8 });
    $('#sig-color')?.addEventListener('input', (e) => {
      pad.color = e.target.value;
      pad.redraw();
    });
    $('#sig-clear')?.addEventListener('click', () => pad.clear());
    const form = canvas.closest('form');
    form?.addEventListener('submit', (e) => {
      const hasFile = $('input[type="file"]', form)?.files.length;
      if (!hasFile && pad.isEmpty()) {
        e.preventDefault();
        toast('कृपया हस्ताक्षर बनाएँ या फ़ाइल चुनें।');
        return;
      }
      $('input[name="drawn"]', form).value = hasFile ? '' : pad.toDataURL({ scale: 3 });
    });
  });
})();

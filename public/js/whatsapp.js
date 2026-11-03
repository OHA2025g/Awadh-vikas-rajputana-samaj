(function () {
  'use strict';
  const { $, $$, escapeHtml: esc, icon, toast, api } = window.ARVS;
  const cfg = JSON.parse($('#wa-config').textContent);

  /* ---------- Gateway status ---------- */

  const GW_TITLE = {
    connected: 'जुड़ा हुआ',
    connecting: 'जुड़ रहा है…',
    qr: 'QR कोड स्कैन करें',
    disconnected: 'जुड़ा नहीं है',
    disabled: 'गेटवे बंद है',
  };
  let gwTimer;

  function renderGateway(g) {
    $('#gw-dot').className = `wa-dot ${g.status}`;
    $('#gw-title').textContent = GW_TITLE[g.status] || g.status;
    const account = g.account?.number ? ` (${g.account.name ? `${g.account.name}, ` : ''}+${g.account.number})` : '';
    $('#gw-message').textContent = (g.message || '') + (g.status === 'connected' ? account : '');
    const qr = $('#gw-qr');
    if (qr) {
      if (g.status === 'qr' && g.qrDataUrl) {
        qr.innerHTML = `<img src="${esc(g.qrDataUrl)}" alt="QR कोड">`;
      } else if (g.status === 'connected') {
        qr.innerHTML = `<span style="color:var(--green)">${icon('check')}<br><b>व्हाट्सऐप जुड़ा हुआ है</b></span>`;
      } else if (g.status === 'connecting') {
        qr.innerHTML = `<span>${icon('refresh')}<br>जुड़ रहा है…</span>`;
      } else {
        qr.innerHTML = `<span>${icon('smartphone')}<br>"कनेक्ट करें" दबाएँ, फिर फ़ोन से QR स्कैन करें</span>`;
      }
    }
    const connectBtn = $('#gw-connect');
    if (connectBtn) connectBtn.disabled = ['connected', 'connecting', 'qr'].includes(g.status);
    const disconnectBtn = $('#gw-disconnect');
    if (disconnectBtn) disconnectBtn.disabled = g.status === 'disconnected';
    scheduleGatewayPoll(['connecting', 'qr'].includes(g.status) ? 2500 : 15000);
  }

  function scheduleGatewayPoll(ms) {
    clearTimeout(gwTimer);
    gwTimer = setTimeout(async () => {
      if (document.hidden) return scheduleGatewayPoll(ms);
      const data = await api('/admin/whatsapp/status');
      if (data.ok) renderGateway(data.gateway);
      else scheduleGatewayPoll(15000);
    }, ms);
  }

  async function gatewayAction(path, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    const data = await api(`/admin/whatsapp/${path}`, { method: 'POST', json: {} });
    if (!data.ok) return toast(data.error, 'error');
    renderGateway(data.gateway);
    scheduleGatewayPoll(1200);
  }
  $('#gw-connect')?.addEventListener('click', () => gatewayAction('connect'));
  $('#gw-disconnect')?.addEventListener('click', () => gatewayAction('disconnect'));
  $('#gw-logout')?.addEventListener('click', () =>
    gatewayAction('logout', 'फ़ोन से इस डिवाइस का लिंक हटाया जाएगा। दोबारा जोड़ने के लिए फिर QR स्कैन करना होगा। जारी रखें?')
  );

  const providerSelect = $('#provider');
  providerSelect?.addEventListener('change', () => {
    $$('[data-provider-fields]').forEach((el) => (el.hidden = el.dataset.providerFields !== providerSelect.value));
  });

  /* ---------- Compose ---------- */

  const msg = $('#wa-message');
  const DRAFT_KEY = 'arvs_wa_draft';
  msg.value = localStorage.getItem(DRAFT_KEY) || '';

  function currentTarget() {
    const type = $('input[name="target-type"]:checked').value;
    const vals = (name) => $$(`input[name="${name}"]:checked`).map((i) => i.value);
    return { type, mandals: vals('mandals'), committees: vals('committees'), categories: vals('categories') };
  }

  $$('input[name="target-type"]').forEach((r) =>
    r.addEventListener('change', () => {
      $$('[data-target-list]').forEach((l) => (l.hidden = l.dataset.targetList !== r.value));
      refreshPreview();
    })
  );
  $$('[data-target-list] input').forEach((i) => i.addEventListener('change', refreshPreview));

  $$('[data-var]').forEach((b) =>
    b.addEventListener('click', () => {
      const tag = b.dataset.var;
      const { selectionStart: s, selectionEnd: e, value } = msg;
      msg.value = value.slice(0, s) + tag + value.slice(e);
      msg.focus();
      msg.selectionStart = msg.selectionEnd = s + tag.length;
      msg.dispatchEvent(new Event('input'));
    })
  );

  let previewTimer;
  msg.addEventListener('input', () => {
    localStorage.setItem(DRAFT_KEY, msg.value);
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 350);
  });

  /** Render WhatsApp-style *bold*, _italic_ and ~strike~ on escaped text. */
  function waFormat(s) {
    return esc(s)
      .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
      .replace(/_([^_\n]+)_/g, '<i>$1</i>')
      .replace(/~([^~\n]+)~/g, '<s>$1</s>');
  }

  let previewSeq = 0;
  let lastCount = 0;
  async function refreshPreview() {
    const seq = ++previewSeq;
    const data = await api('/admin/whatsapp/preview', { method: 'POST', json: { target: currentTarget(), message: msg.value } });
    if (seq !== previewSeq) return;
    if (!data.ok) return toast(data.error, 'error');
    lastCount = data.count;
    $('#wa-count').textContent = data.count;
    $('#wa-label').textContent = data.label;
    $('#wa-preview').innerHTML = data.preview.trim() ? waFormat(data.preview) : '<span class="muted">संदेश लिखें…</span>';
    $('#wa-recipients').innerHTML = data.recipients.length
      ? data.recipients
          .map((r) => `<div><span>${esc(r.name)}${r.mandal ? ` <span class="muted">· ${esc(r.mandal)}</span>` : ''}</span><span class="mono muted">${esc(r.phone)}</span></div>`)
          .join('') + (data.count > data.recipients.length ? `<div class="muted">…और ${data.count - data.recipients.length}</div>` : '')
      : '<div class="muted">इस समूह में व्हाट्सऐप नंबर वाला कोई सदस्य नहीं है।</div>';
  }

  $('#wa-send').addEventListener('click', async () => {
    if (msg.value.trim().length < 2) return toast('कृपया संदेश लिखें।', 'error');
    if (!lastCount) return toast('चुने गए समूह में कोई प्राप्तकर्ता नहीं है।', 'error');
    if (!window.confirm(`${lastCount} सदस्यों को यह संदेश भेजा जाएगा। जारी रखें?`)) return;
    const btn = $('#wa-send');
    btn.disabled = true;
    const data = await api('/admin/whatsapp/send', { method: 'POST', json: { target: currentTarget(), message: msg.value } });
    btn.disabled = false;
    if (!data.ok) return toast(data.error, 'error');
    history.unshift(data.broadcast);
    renderHistory();
    localStorage.removeItem(DRAFT_KEY);
    toast(data.warning || 'प्रसारण कतार में जोड़ा गया — संदेश भेजे जा रहे हैं।', data.warning ? 'error' : 'success');
    scheduleHistoryPoll();
  });

  $('#test-send')?.addEventListener('click', async () => {
    const phone = $('#test-phone').value.trim();
    if (!phone) return toast('मोबाइल नंबर लिखें।', 'error');
    const data = await api('/admin/whatsapp/test', { method: 'POST', json: { phone, message: msg.value.trim() ? msg.value.replace(/\{[a-z_]+\}/g, '') : '' } });
    toast(data.ok ? 'परीक्षण संदेश भेजा गया ✅' : data.error, data.ok ? 'success' : 'error');
  });

  /* ---------- History ---------- */

  const STATUS = {
    queued: ['कतार में', 'gold'],
    running: ['भेजा जा रहा है', 'blue'],
    paused: ['रुका हुआ', 'gray'],
    done: ['पूर्ण', 'green'],
    cancelled: ['रद्द', 'red'],
  };
  const history = cfg.broadcasts;

  function actionsFor(b) {
    const btn = (action, label, cls = 'btn-outline') =>
      `<button type="button" class="btn ${cls} btn-sm" data-bc-action="${action}" data-id="${b.id}">${label}</button>`;
    const out = [`<button type="button" class="btn btn-outline btn-sm btn-icon" data-bc-view="${b.id}" title="विवरण">${icon('eye')}</button>`];
    if (b.status === 'running' || b.status === 'queued') out.push(btn('pause', `${icon('pause')} रोकें`));
    if (b.status === 'paused') out.push(btn('resume', `${icon('play')} पुनः आरंभ`, 'btn-green'));
    if (b.failed > 0 && b.status !== 'running') out.push(btn('retry', `${icon('refresh')} विफल पुनः भेजें`));
    if (['queued', 'running', 'paused'].includes(b.status)) out.push(btn('cancel', icon('x'), 'btn-danger'));
    return out.join('');
  }

  function renderHistory() {
    const tbody = $('#wa-history');
    if (!history.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">${icon('message-circle')}<p>अभी तक कोई प्रसारण नहीं।</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = history
      .map((b) => {
        const [label, cls] = STATUS[b.status] || [b.status, 'gray'];
        const pct = b.total ? Math.round(((b.sent + b.failed) / b.total) * 100) : 0;
        const snippet = b.message.length > 70 ? `${b.message.slice(0, 70)}…` : b.message;
        return `<tr data-bc="${b.id}">
          <td class="nowrap small">${esc(b.created)}</td>
          <td>${esc(b.target_label)}</td>
          <td class="small muted">${esc(snippet)}</td>
          <td style="min-width:150px"><div class="progress"><span style="width:${pct}%"></span></div>
            <div class="cell-sub">${b.sent} भेजे${b.failed ? ` · <span style="color:var(--red)">${b.failed} विफल</span>` : ''} / ${b.total}</div></td>
          <td><span class="badge ${cls}">${label}</span></td>
          <td><div class="actions">${actionsFor(b)}</div></td>
        </tr>`;
      })
      .join('');
  }

  function upsert(b) {
    const i = history.findIndex((x) => x.id === b.id);
    if (i >= 0) history[i] = b;
    else history.unshift(b);
  }

  let historyTimer;
  function scheduleHistoryPoll() {
    clearTimeout(historyTimer);
    const active = history.filter((b) => b.status === 'running' || b.status === 'queued');
    if (!active.length) return;
    historyTimer = setTimeout(async () => {
      for (const b of active) {
        const data = await api(`/admin/whatsapp/broadcasts/${b.id}`);
        if (data.ok) upsert(data.broadcast);
      }
      renderHistory();
      scheduleHistoryPoll();
    }, 4000);
  }

  $('#wa-history').addEventListener('click', async (e) => {
    const actionBtn = e.target.closest('[data-bc-action]');
    if (actionBtn) {
      const { bcAction, id } = actionBtn.dataset;
      if (bcAction === 'cancel' && !window.confirm('यह प्रसारण रद्द करें? बचे हुए संदेश नहीं भेजे जाएँगे।')) return;
      actionBtn.disabled = true;
      const data = await api(`/admin/whatsapp/broadcasts/${id}/${bcAction}`, { method: 'POST', json: {} });
      if (!data.ok) {
        actionBtn.disabled = false;
        return toast(data.error, 'error');
      }
      upsert(data.broadcast);
      renderHistory();
      scheduleHistoryPoll();
      return;
    }
    const viewBtn = e.target.closest('[data-bc-view]');
    if (viewBtn) {
      const data = await api(`/admin/whatsapp/broadcasts/${viewBtn.dataset.bcView}`);
      if (!data.ok) return toast(data.error, 'error');
      const b = data.broadcast;
      const RS = { sent: ['भेजा', 'green'], failed: ['विफल', 'red'], pending: ['बाकी', 'gold'], skipped: ['छोड़ा', 'gray'] };
      $('#bc-modal-title').textContent = b.target_label;
      $('#bc-modal-body').innerHTML = `
        <div class="wa-preview" style="margin-bottom:14px"><div class="wa-bubble">${waFormat(b.message)}</div></div>
        <div class="recipient-list" style="max-height:340px">${data.recipients
          .map((r) => {
            const [l, c] = RS[r.status] || [r.status, 'gray'];
            return `<div><span>${esc(r.name)} <span class="mono muted">${esc(r.phone)}</span>${r.error ? `<br><small style="color:var(--red)">${esc(r.error)}</small>` : ''}</span><span class="badge ${c}">${l}</span></div>`;
          })
          .join('')}</div>`;
      $('#bc-modal').classList.add('open');
    }
  });

  renderGateway(cfg.gateway);
  renderHistory();
  scheduleHistoryPoll();
  refreshPreview();
})();

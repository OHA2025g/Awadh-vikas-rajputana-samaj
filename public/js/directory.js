(function () {
  'use strict';
  const { $, $$, escapeHtml, icon, api } = window.ARVS;

  const app = $('#directory-app');
  if (!app) return;

  const params = new URLSearchParams(location.search);
  const state = {
    category: app.dataset.initialCategory || '',
    mandal: params.get('mandal') || '',
    committee: params.get('committee') || '',
    q: params.get('q') || '',
    page: 1,
  };

  const grid = $('#dir-grid');
  const info = $('#dir-info');
  const pager = $('#dir-pager');
  const qInput = $('#dir-q');
  const mandalSel = $('#dir-mandal');
  const committeeSel = $('#dir-committee');
  const CAT_LABEL = { pramukh: 'प्रमुख', padadhikari: 'पदाधिकारी', sadasya: 'सदस्य' };
  const CAT_TAG = { pramukh: 'maroon', padadhikari: '', sadasya: 'gold' };

  qInput.value = state.q;
  mandalSel.value = state.mandal;
  committeeSel.value = state.committee;

  function syncUi() {
    $$('.dir-tab').forEach((t) => t.classList.toggle('active', t.dataset.category === state.category));
    $$('#mandal-chips .chip').forEach((c) => c.classList.toggle('active', c.dataset.mandal === String(state.mandal)));
    mandalSel.value = state.mandal;
  }

  function avatar(m) {
    if (m.photo) return `<img class="avatar" src="${escapeHtml(m.photo)}" alt="" loading="lazy">`;
    const letters = String(m.name || '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => Array.from(p)[0] || '')
      .join('');
    return `<span class="avatar">${escapeHtml(letters)}</span>`;
  }

  function card(m) {
    const rows = [
      m.mandal && ['मंडल', m.mandal],
      m.committee && ['समिति', m.committee],
      m.city && ['शहर', m.city],
      m.phone && ['मोबाइल', m.phone],
    ].filter(Boolean);
    return `
      <article class="member-card ${escapeHtml(m.category)}">
        <span class="tag ${CAT_TAG[m.category] || ''} cat-pill">${escapeHtml(CAT_LABEL[m.category] || '')}</span>
        ${m.member_no ? `<span class="member-no">${escapeHtml(m.member_no)}</span>` : ''}
        ${avatar(m)}
        <h3>${escapeHtml([m.salutation, m.name].filter(Boolean).join(' '))}</h3>
        ${m.designation ? `<div class="designation">${escapeHtml(m.designation)}</div>` : ''}
        <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
      </article>`;
  }

  function renderPager(page, pages) {
    if (pages <= 1) {
      pager.innerHTML = '';
      return;
    }
    const btns = [];
    const add = (p, label = p) =>
      btns.push(
        p === page
          ? `<span class="current">${label}</span>`
          : `<button type="button" data-page="${p}">${label}</button>`
      );
    if (page > 1) btns.push(`<button type="button" data-page="${page - 1}">${icon('chevron-left')}</button>`);
    for (let p = 1; p <= pages; p++) {
      if (p === 1 || p === pages || Math.abs(p - page) <= 2) add(p);
      else if (Math.abs(p - page) === 3) btns.push('<span>…</span>');
    }
    if (page < pages) btns.push(`<button type="button" data-page="${page + 1}">${icon('chevron-right')}</button>`);
    pager.innerHTML = btns.join('');
  }

  let seq = 0;
  async function load() {
    syncUi();
    const mySeq = ++seq;
    const qs = new URLSearchParams();
    for (const k of ['category', 'mandal', 'committee', 'q', 'page']) if (state[k]) qs.set(k, state[k]);
    const urlQs = new URLSearchParams(qs);
    urlQs.delete('page');
    history.replaceState(null, '', `/directory${urlQs.toString() ? `?${urlQs}` : ''}`);
    info.textContent = 'लोड हो रहा है…';
    const data = await api(`/api/directory?${qs}`);
    if (mySeq !== seq) return;
    if (!data.ok) {
      info.textContent = data.error || 'सूची लोड नहीं हो सकी।';
      return;
    }
    for (const [k, n] of Object.entries(data.counts)) {
      const el = $(`[data-count="${k}"]`);
      if (el) el.textContent = n;
    }
    const label = state.category ? CAT_LABEL[state.category] : 'सभी सदस्य';
    info.textContent = `${label}: कुल ${data.total} परिणाम${data.pages > 1 ? ` (पृष्ठ ${data.page}/${data.pages})` : ''}`;
    grid.innerHTML = data.items.length
      ? data.items.map(card).join('')
      : `<div class="empty" style="grid-column:1/-1">${icon('search')}<p>कोई सदस्य नहीं मिला। कृपया खोज या फ़िल्टर बदलें।</p></div>`;
    renderPager(data.page, data.pages);
  }

  $$('.dir-tab').forEach((t) =>
    t.addEventListener('click', () => {
      state.category = t.dataset.category;
      state.page = 1;
      load();
    })
  );
  $$('#mandal-chips .chip').forEach((c) =>
    c.addEventListener('click', () => {
      state.mandal = c.dataset.mandal;
      state.page = 1;
      load();
    })
  );
  mandalSel.addEventListener('change', () => {
    state.mandal = mandalSel.value;
    state.page = 1;
    load();
  });
  committeeSel.addEventListener('change', () => {
    state.committee = committeeSel.value;
    state.page = 1;
    load();
  });
  let debounce;
  qInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = qInput.value.trim();
      state.page = 1;
      load();
    }, 250);
  });
  $('#dir-reset').addEventListener('click', () => {
    Object.assign(state, { category: '', mandal: '', committee: '', q: '', page: 1 });
    qInput.value = '';
    committeeSel.value = '';
    load();
  });
  pager.addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    state.page = Number(b.dataset.page);
    load();
    app.scrollIntoView({ behavior: 'smooth' });
  });

  load();
})();

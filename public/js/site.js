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
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  async function api(url, { method = 'GET', body, json } = {}) {
    const headers = { Accept: 'application/json' };
    let payload = body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(json);
    }
    const csrf = document.querySelector('meta[name="csrf-token"]');
    if (csrf) headers['X-CSRF-Token'] = csrf.content;
    const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
    let data = {};
    try {
      data = await res.json();
    } catch {
      data = { ok: false, error: 'सर्वर से अमान्य उत्तर मिला।' };
    }
    if (!res.ok && data.ok !== false) data.ok = false;
    if (!res.ok && !data.error && !data.errors) data.error = `त्रुटि (${res.status})`;
    return data;
  }

  window.ARVS = { $, $$, escapeHtml, icon, toast, api };

  /* Mobile navigation */
  const nav = $('#main-nav');
  const backdrop = $('.nav-backdrop');
  function setNav(open) {
    if (!nav) return;
    nav.classList.toggle('open', open);
    backdrop?.classList.toggle('show', open);
    document.body.style.overflow = open ? 'hidden' : '';
  }
  $$('[data-nav-open]').forEach((b) => b.addEventListener('click', () => setNav(true)));
  $$('[data-nav-close]').forEach((b) => b.addEventListener('click', () => setNav(false)));
  nav?.addEventListener('click', (e) => {
    if (e.target.closest('a')) setNav(false);
  });

  /* Reveal on scroll */
  const reveals = $$('.reveal');
  if ('IntersectionObserver' in window && reveals.length) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -60px 0px' }
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add('visible'));
  }

  /* Modals */
  $$('[data-open-modal]').forEach((btn) =>
    btn.addEventListener('click', () => document.getElementById(btn.dataset.openModal)?.classList.add('open'))
  );
  $$('.modal').forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.remove('open');
    });
  });

  /* Gallery lightbox */
  const lightbox = $('#lightbox');
  if (lightbox) {
    const img = $('img', lightbox);
    $$('[data-gallery] a').forEach((a) =>
      a.addEventListener('click', (e) => {
        e.preventDefault();
        img.src = a.getAttribute('href');
        lightbox.classList.add('open');
      })
    );
    lightbox.addEventListener('click', (e) => {
      if (e.target === lightbox || e.target.closest('[data-close-lightbox]')) lightbox.classList.remove('open');
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    $$('.modal.open, .lightbox.open').forEach((m) => m.classList.remove('open'));
    setNav(false);
  });
})();

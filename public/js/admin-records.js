/* Donation entry, meeting register and attachment preview behaviour (admin only). */
(function () {
  'use strict';

  const { $, $$, escapeHtml, icon, toast, api } = window.ARVS;

  const initials = (name) =>
    String(name ?? '')
      .replace(/^(श्री|श्रीमती|कु\.|सुश्री|डॉ\.|ठा\.|स्व\.)\s*/u, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => Array.from(p)[0] || '')
      .join('');

  const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  /* ---------- Approved-member search box with keyboard navigation ---------- */

  function memberCombobox(input, { endpoint, onPick, badge = () => '' }) {
    const list = document.getElementById(input.getAttribute('aria-controls'));
    let items = [];
    let active = -1;
    let timer;
    let seq = 0;

    const close = () => {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    };

    const highlight = (i) => {
      active = i;
      Array.from(list.children).forEach((li, j) => li.classList.toggle('active', j === i));
      const el = list.children[i];
      el?.scrollIntoView({ block: 'nearest' });
      if (el?.id) input.setAttribute('aria-activedescendant', el.id);
    };

    const render = () => {
      list.innerHTML = items.length
        ? items
            .map(
              (m, i) => `<li id="${list.id}-${i}" role="option" data-i="${i}">
                <span class="thumb round">${escapeHtml(initials(m.name))}</span>
                <span class="mp-text"><b>${escapeHtml(m.name)}</b><small>${escapeHtml([m.member_no, m.place].filter(Boolean).join(' • '))}</small></span>
                ${badge(m)}
              </li>`
            )
            .join('')
        : '<li class="mp-none">कोई स्वीकृत सदस्य नहीं मिला।</li>';
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      active = -1;
    };

    const search = async () => {
      const mine = ++seq;
      const data = await api(`${endpoint}?${new URLSearchParams({ q: input.value.trim() })}`);
      if (mine !== seq) return;
      if (data.ok === false) {
        toast(data.error, 'error');
        return;
      }
      items = data.members || [];
      render();
    };

    const pick = (i) => {
      const m = items[i];
      if (!m) return;
      close();
      onPick(m);
    };

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(search, 200);
    });
    input.addEventListener('focus', search);
    input.addEventListener('blur', () => setTimeout(close, 150));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
      if (list.hidden) {
        if (e.key === 'ArrowDown') search();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        highlight(Math.min(items.length - 1, active + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlight(Math.max(0, active - 1));
      } else if (e.key === 'Enter') {
        pick(active >= 0 ? active : items.length === 1 ? 0 : -1);
      } else if (e.key === 'Escape') {
        close();
      }
    });
    list.addEventListener('mousedown', (e) => e.preventDefault());
    list.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-i]');
      if (li) pick(Number(li.dataset.i));
    });
    return { refresh: search };
  }

  /* ---------- Donation entry form ---------- */

  const donationPicker = $('[data-member-picker]');
  if (donationPicker) {
    const form = donationPicker.closest('form');
    const hidden = $('input[name="member_id"]', donationPicker);
    const selected = $('[data-mp-selected]', donationPicker);
    const searchBox = $('[data-mp-search]', donationPicker);
    const input = $('input[type="search"]', donationPicker);
    const warn = $('[data-mp-lifetime]', donationPicker);
    let lifetimePaid = false;
    const phoneBox = $('#f-phone', form);
    const PHONE_PLACEHOLDER = '10 अंकों का मोबाइल नंबर';

    /** Fill the mobile from the member list unless the admin typed a different number. */
    const setMemberPhone = (m) => {
      const typedByAdmin = phoneBox.value.trim() && phoneBox.value !== phoneBox.dataset.autoPhone;
      if (!typedByAdmin) {
        phoneBox.value = m?.member_phone || '';
        phoneBox.dataset.autoPhone = phoneBox.value;
      }
      phoneBox.placeholder = m?.member_phone_hint ? `सदस्य सूची का नंबर: ${m.member_phone_hint}` : PHONE_PLACEHOLDER;
    };

    const updateWarn = () => {
      warn.hidden = !(lifetimePaid && $('input[name="category"]:checked', form)?.value === 'lifetime');
    };

    memberCombobox(input, {
      endpoint: donationPicker.dataset.memberPicker,
      badge: (m) => (m.lifetime_paid ? '<span class="badge green">आजीवन शुल्क जमा</span>' : ''),
      onPick: (m) => {
        hidden.value = m.id;
        $('[data-mp-name]', donationPicker).textContent = m.name;
        $('[data-mp-sub]', donationPicker).textContent = [m.member_no, m.place].filter(Boolean).join(' • ');
        $('[data-mp-initials]', donationPicker).textContent = initials(m.name);
        selected.hidden = false;
        searchBox.hidden = true;
        lifetimePaid = Boolean(m.lifetime_paid);
        setMemberPhone(m);
        updateWarn();
        if (!$('#f-amount').disabled) $('#f-amount').focus();
      },
    });

    $('[data-mp-change]', donationPicker).addEventListener('click', () => {
      hidden.value = '';
      lifetimePaid = false;
      setMemberPhone(null);
      updateWarn();
      selected.hidden = true;
      searchBox.hidden = false;
      input.value = '';
      input.focus();
    });

    const amountField = $('[data-amount-field]', form);
    const amountInput = $('#f-amount', form);
    const fixedFee = $('[data-fixed-fee]', form);
    const phoneField = $('[data-phone-field]', form);
    const phoneInput = $('#f-phone', form);
    const updateCategory = () => {
      const category = $('input[name="category"]:checked', form)?.value;
      const isLifetime = category === 'lifetime';
      amountField.hidden = isLifetime;
      amountInput.disabled = isLifetime;
      amountInput.required = !isLifetime;
      fixedFee.hidden = !isLifetime;
      phoneField.hidden = category !== 'daan';
      phoneInput.disabled = category !== 'daan';
      updateWarn();
    };
    $$('input[name="category"]', form).forEach((r) => r.addEventListener('change', updateCategory));

    form.addEventListener('submit', (e) => {
      if (!searchBox.hidden) {
        e.preventDefault();
        toast('कृपया सूची में से एक स्वीकृत सदस्य चुनें।', 'error');
        input.focus();
      }
    });

    const REF_HINTS = {
      cash: ['रसीद क्रमांक', 'नकद भुगतान की रसीद संख्या (यदि दी गई हो)।'],
      online: ['UTR / ट्रांज़ैक्शन ID', 'NEFT / IMPS / RTGS का UTR या बैंक संदर्भ संख्या।'],
      upi: ['UPI ट्रांज़ैक्शन ID / UTR', 'UPI ऐप में दिखने वाला 12 अंकों का UTR / Ref No.'],
      cheque: ['चेक नंबर व बैंक', 'जैसे: 004512 — SBI, पुणे'],
    };
    const ref = $('#f-reference');
    const refHint = $('[data-ref-hint]');
    const updateRef = () => {
      const hint = REF_HINTS[$('input[name="payment_mode"]:checked', form)?.value];
      if (!hint) return;
      ref.placeholder = hint[0];
      refHint.textContent = hint[1];
    };
    $$('input[name="payment_mode"]', form).forEach((r) => r.addEventListener('change', updateRef));
    updateRef();
  }

  /* ---------- Meeting attendees ---------- */

  const attInput = $('[data-att-input]');
  if (attInput) {
    let list;
    try {
      list = JSON.parse(attInput.value || '[]');
    } catch {
      list = [];
    }
    if (!Array.isArray(list)) list = [];
    const chips = $('[data-att-chips]');
    const countEl = $('[data-att-count]');
    const empty = $('[data-att-empty]');
    const picker = $('[data-attendee-picker]');
    const endpoint = picker.dataset.attendeePicker;
    const keyOf = (a) => (a.id ? `m${a.id}` : `n${String(a.name).toLowerCase()}`);

    const sync = () => {
      attInput.value = JSON.stringify(list);
      countEl.textContent = list.length;
      empty.hidden = list.length > 0;
      chips.innerHTML = list
        .map(
          (a, i) => `<span class="att-chip${a.id ? '' : ' guest'}">
            <span>${escapeHtml(a.name)}${a.role ? `<small>${escapeHtml(a.role)}</small>` : ''}</span>
            <button type="button" data-remove="${i}" aria-label="${escapeHtml(a.name)} हटाएँ">${icon('x')}</button>
          </span>`
        )
        .join('');
    };
    const add = (a) => {
      if (list.some((x) => keyOf(x) === keyOf(a))) return false;
      list.push(a);
      return true;
    };

    chips.addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b) return;
      list.splice(Number(b.dataset.remove), 1);
      sync();
    });

    const search = $('input[type="search"]', picker);
    memberCombobox(search, {
      endpoint,
      badge: (m) => (list.some((x) => x.id === m.id) ? '<span class="badge green">जोड़ा गया</span>' : ''),
      onPick: (m) => {
        if (!add({ id: m.id, name: m.name, role: m.role })) toast('यह सदस्य पहले से जोड़ा गया है।');
        sync();
        search.value = '';
      },
    });

    const committeeSel = $('#f-committee');
    const committeeBtn = $('[data-att-committee]');
    const updateCommitteeBtn = () => {
      committeeBtn.disabled = !committeeSel.value;
      committeeBtn.title = committeeSel.value ? '' : 'ऊपर समिति चुनें';
    };
    committeeSel.addEventListener('change', updateCommitteeBtn);
    updateCommitteeBtn();
    committeeBtn.addEventListener('click', async () => {
      const data = await api(`${endpoint}?${new URLSearchParams({ committee: committeeSel.value })}`);
      if (data.ok === false) return toast(data.error, 'error');
      let added = 0;
      for (const m of data.members || []) if (add({ id: m.id, name: m.name, role: m.role })) added++;
      sync();
      toast(added ? `${added} सदस्य जोड़े गए।` : 'इस समिति के सभी स्वीकृत सदस्य पहले से जुड़े हैं (या समिति में कोई सदस्य नहीं है)।');
    });

    const other = $('#att-other');
    const addOther = () => {
      const name = other.value.trim().replace(/\s+/g, ' ').slice(0, 100);
      if (!name) return;
      if (!add({ name })) toast('यह नाम पहले से जोड़ा गया है।');
      other.value = '';
      sync();
      other.focus();
    };
    $('[data-att-add-other]').addEventListener('click', addOther);
    other.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addOther();
      }
    });

    $('[data-att-clear]').addEventListener('click', () => {
      if (list.length && window.confirm('सभी उपस्थित नाम हटाएँ?')) {
        list = [];
        sync();
      }
    });

    sync();
  }

  /* ---------- Minutes template ---------- */

  $('[data-minutes-template]')?.addEventListener('click', () => {
    const area = $('#f-minutes')?.nextElementSibling?.querySelector('.rte-area');
    if (!area) return;
    const template =
      '<h3>एजेंडा</h3><ol><li>&nbsp;</li></ol>' +
      '<h3>चर्चा के मुख्य बिंदु</h3><ul><li>&nbsp;</li></ul>' +
      '<h3>लिए गए निर्णय</h3><ol><li>&nbsp;</li></ol>' +
      '<h3>अगली बैठक</h3><p>&nbsp;</p>';
    if (area.innerText.trim()) {
      if (!window.confirm('विवरण में पहले से कुछ लिखा है। प्रारूप अंत में जोड़ें?')) return;
      area.insertAdjacentHTML('beforeend', template);
    } else {
      area.innerHTML = template;
    }
    area.dispatchEvent(new Event('input'));
    area.focus();
  });

  /* ---------- Attachment picker (adds to the selection instead of replacing it) ---------- */

  const fileInput = $('[data-file-input]');
  if (fileInput && window.DataTransfer) {
    const preview = $('[data-file-preview]');
    const zone = $('[data-dropzone]');
    const ALLOWED = /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/;
    const MAX_BYTES = 12 * 1024 * 1024;
    const MAX_FILES = 20;
    let selection = new DataTransfer();
    let urls = [];

    const render = () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls = [];
      preview.innerHTML = Array.from(selection.files)
        .map((f, i) => {
          let thumb = `<span class="pdf-thumb">${icon('file-text')} PDF</span>`;
          if (f.type.startsWith('image/')) {
            const u = URL.createObjectURL(f);
            urls.push(u);
            thumb = `<img src="${u}" alt="">`;
          }
          return `<div class="file-tile new">${thumb}
            <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <span class="muted small">${fileSize(f.size)} • नई</span>
            <button type="button" class="btn btn-outline btn-sm" data-unselect="${i}">${icon('x')} हटाएँ</button>
          </div>`;
        })
        .join('');
    };

    const addFiles = (files) => {
      for (const f of files) {
        if (!ALLOWED.test(f.type)) {
          toast(`${f.name}: केवल JPG, PNG या PDF फ़ाइल चुनें।`, 'error');
          continue;
        }
        if (f.size > MAX_BYTES) {
          toast(`${f.name}: फ़ाइल 12 MB से बड़ी है।`, 'error');
          continue;
        }
        if (selection.files.length >= MAX_FILES) {
          toast(`एक बार में अधिकतम ${MAX_FILES} फ़ाइलें जोड़ी जा सकती हैं।`, 'error');
          break;
        }
        selection.items.add(f);
      }
      fileInput.files = selection.files;
      render();
    };

    fileInput.addEventListener('change', () => {
      const picked = Array.from(fileInput.files);
      fileInput.files = selection.files;
      addFiles(picked);
    });

    preview.addEventListener('click', (e) => {
      const b = e.target.closest('[data-unselect]');
      if (!b) return;
      const next = new DataTransfer();
      Array.from(selection.files).forEach((f, i) => i !== Number(b.dataset.unselect) && next.items.add(f));
      selection = next;
      fileInput.files = selection.files;
      render();
    });

    ['dragenter', 'dragover'].forEach((type) =>
      zone.addEventListener(type, (e) => {
        e.preventDefault();
        zone.classList.add('over');
      })
    );
    ['dragleave', 'drop'].forEach((type) =>
      zone.addEventListener(type, (e) => {
        e.preventDefault();
        zone.classList.remove('over');
      })
    );
    zone.addEventListener('drop', (e) => addFiles(Array.from(e.dataTransfer.files)));
  }

  /* ---------- Lightbox for register scans ---------- */

  const lb = $('#lightbox');
  if (lb) {
    const stage = $('[data-lb-stage]', lb);
    const caption = $('[data-lb-caption]', lb);
    const counter = $('[data-lb-counter]', lb);
    const openLink = $('[data-lb-open]', lb);
    const download = $('[data-lb-download]', lb);
    const zoomBtn = $('[data-lb-zoom]', lb);
    const closeBtn = $('[data-lb-close]', lb);
    let group = [];
    let index = 0;
    let lastFocus = null;

    const show = (i) => {
      index = (i + group.length) % group.length;
      const a = group[index];
      const href = a.getAttribute('href');
      const isPdf = a.dataset.kind === 'pdf';
      stage.classList.remove('zoomed');
      stage.innerHTML = isPdf
        ? `<div class="lb-pdf">${icon('file-text')}<strong>${escapeHtml(a.dataset.caption || 'PDF')}</strong>
             <a class="btn btn-primary" href="${escapeHtml(href)}" target="_blank" rel="noopener">${icon('external-link')} PDF खोलें</a></div>`
        : `<img src="${escapeHtml(href)}" alt="${escapeHtml(a.dataset.caption || '')}">`;
      caption.textContent = a.dataset.caption || '';
      counter.textContent = group.length > 1 ? `${index + 1} / ${group.length}` : '';
      openLink.href = href;
      download.href = `${href}?download=1`;
      zoomBtn.hidden = isPdf;
      lb.classList.toggle('single', group.length < 2);
    };

    const open = (a) => {
      group = $$(`a[data-lightbox="${CSS.escape(a.dataset.lightbox)}"]`);
      lastFocus = document.activeElement;
      show(Math.max(0, group.indexOf(a)));
      lb.hidden = false;
      document.body.classList.add('lb-open');
      closeBtn.focus();
    };

    const close = () => {
      lb.hidden = true;
      stage.innerHTML = '';
      document.body.classList.remove('lb-open');
      lastFocus?.focus();
    };

    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-lightbox]');
      if (!a || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      e.preventDefault();
      open(a);
    });
    closeBtn.addEventListener('click', close);
    $('[data-lb-prev]', lb).addEventListener('click', () => show(index - 1));
    $('[data-lb-next]', lb).addEventListener('click', () => show(index + 1));
    zoomBtn.addEventListener('click', () => stage.classList.toggle('zoomed'));
    stage.addEventListener('click', (e) => {
      if (e.target.tagName === 'IMG') stage.classList.toggle('zoomed');
      else if (e.target === stage) close();
    });
    document.addEventListener('keydown', (e) => {
      if (lb.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'ArrowRight') show(index + 1);
    });
  }

  $$('[data-print]').forEach((b) => b.addEventListener('click', () => window.print()));
})();

(function () {
  'use strict';
  const { $, $$, escapeHtml } = window.ARVS;

  const form = $('#join-form');
  if (!form) return;

  const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
  const FAMILY_ROWS = 6;
  const RELATIVE_ROWS = 4;

  const sigWrap = $('#sig-wrap');
  const pad = new window.SignaturePad($('#sig-canvas'), {
    onChange: (p) => {
      sigWrap.classList.toggle('signed', !p.isEmpty());
      if (!p.isEmpty()) clearError('signature');
    },
  });
  $('#sig-clear').addEventListener('click', () => pad.clear());

  $$('input[inputmode="numeric"]', form).forEach((el) =>
    el.addEventListener('input', () => {
      const clean = el.value.replace(el.name === 'aadhaar' ? /[^\d ]/g : /[^\d+]/g, '');
      if (clean !== el.value) el.value = clean;
    })
  );

  /* Photo: downscale in the browser so uploads stay small on mobile data */
  let photoBlob = null;
  const photoInput = $('#photo');
  const preview = $('#photo-preview');

  function resizeImage(file, maxSide = 900) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('resize failed'))), 'image/jpeg', 0.86);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('invalid image'));
      };
      img.src = url;
    });
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files[0];
    photoBlob = null;
    preview.classList.remove('has-image');
    preview.style.backgroundImage = '';
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return showError('photo', 'केवल JPG, PNG या WEBP फोटो चुनें।');
    if (file.size > MAX_PHOTO_BYTES * 3) return showError('photo', 'फोटो बहुत बड़ी है।');
    try {
      photoBlob = await resizeImage(file);
      preview.style.backgroundImage = `url(${URL.createObjectURL(photoBlob)})`;
      preview.classList.add('has-image');
      clearError('photo');
    } catch {
      showError('photo', 'यह फोटो पढ़ी नहीं जा सकी, कृपया दूसरी फोटो चुनें।');
    }
  });

  /* Validation helpers */
  function fieldFor(name) {
    return $(`[data-field="${name}"]`, form);
  }

  function showError(name, msg) {
    const f = fieldFor(name);
    if (!f) return;
    f.classList.add('has-error');
    const el = $('.field-error', f);
    if (el) el.textContent = msg;
  }

  function clearError(name) {
    fieldFor(name)?.classList.remove('has-error');
  }

  form.addEventListener('input', (e) => e.target.name && clearError(e.target.name));
  form.addEventListener('change', (e) => e.target.name && clearError(e.target.name));

  const localPhone = (s) => s.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const validPhone = (s) => /^[6-9]\d{9}$/.test(localPhone(s));

  function validateRows(prefix, count, extraKeys, errors, v) {
    for (let i = 1; i <= count; i++) {
      const key = (k) => `${prefix}_${i}_${k}`;
      const age = v(key('age'));
      const phone = v(key('phone'));
      const filled = [age, phone, v(key('relation')), ...extraKeys.map((k) => v(key(k)))].some(Boolean);
      if (!v(key('name')) && filled) errors[key('name')] = 'नाम लिखें।';
      if (age && !(Number(age) >= 0 && Number(age) <= 120)) errors[key('age')] = 'उम्र सही लिखें।';
      if (phone && !validPhone(phone)) errors[key('phone')] = 'मोबाइल नंबर मान्य नहीं है।';
    }
  }

  function validate() {
    const errors = {};
    const v = (n) => (form.elements[n]?.value || '').trim();
    if (v('name').length < 2) errors.name = 'कृपया सदस्य का पूरा नाम लिखें।';
    const age = Number(v('age'));
    if (!v('age') || !(age >= 1 && age <= 120)) errors.age = 'कृपया सही उम्र लिखें।';
    const aadhaar = v('aadhaar').replace(/\D/g, '');
    if (aadhaar && !/^[2-9]\d{11}$/.test(aadhaar)) errors.aadhaar = 'आधार कार्ड नंबर 12 अंकों का होना चाहिए।';
    if (!validPhone(v('phone'))) errors.phone = 'कृपया 10 अंकों का मान्य मोबाइल नंबर लिखें।';
    if (v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'))) errors.email = 'ईमेल पता मान्य नहीं है।';
    if (v('father_name').length < 2) errors.father_name = 'माता / पिता या पति का नाम आवश्यक है।';
    if (!v('perm_village')) errors.perm_village = 'स्थायी पते का ग्राम लिखें।';
    if (!v('perm_district')) errors.perm_district = 'स्थायी पते का जिला लिखें।';
    if (v('perm_pincode') && !/^\d{6}$/.test(v('perm_pincode'))) errors.perm_pincode = 'पिनकोड 6 अंकों का होना चाहिए।';
    if (v('address').length < 5) errors.address = 'कृपया वर्तमान पता लिखें।';
    if (v('pincode') && !/^\d{6}$/.test(v('pincode'))) errors.pincode = 'पिनकोड 6 अंकों का होना चाहिए।';
    validateRows('family', FAMILY_ROWS, [], errors, v);
    validateRows('relative', RELATIVE_ROWS, ['address'], errors, v);
    if (!form.elements.declaration.checked) errors.declaration = 'कृपया घोषणा स्वीकार करें।';
    if (pad.isEmpty()) errors.signature = 'कृपया हस्ताक्षर करें।';
    return errors;
  }

  function showErrors(errors) {
    Object.entries(errors).forEach(([k, msg]) => showError(k, msg));
    const target = Object.keys(errors).map(fieldFor).find(Boolean);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const banner = $('#join-error');
  const submitBtn = $('#join-submit');
  const submitHtml = submitBtn.innerHTML;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    banner.hidden = true;
    const errors = validate();
    if (Object.keys(errors).length) {
      showErrors(errors);
      return;
    }
    $('#signature').value = pad.toDataURL();
    const fd = new FormData(form);
    fd.delete('photo');
    if (photoBlob) fd.append('photo', photoBlob, 'photo.jpg');

    submitBtn.disabled = true;
    submitBtn.textContent = 'जमा हो रहा है…';
    try {
      const res = await fetch('/join', { method: 'POST', body: fd, headers: { Accept: 'application/json' } });
      const data = await res.json().catch(() => ({ ok: false, error: 'सर्वर से अमान्य उत्तर मिला।' }));
      if (data.ok) {
        form.hidden = true;
        $('#success-name').textContent = data.name || '';
        $('#success-appno').textContent = data.application_no;
        $('#join-success').hidden = false;
        $('#join-success').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (data.errors) showErrors(data.errors);
      const msg = data.error || (data.errors ? 'कृपया लाल रंग में दर्शाई गई त्रुटियाँ ठीक करें।' : 'फॉर्म जमा नहीं हो सका।');
      $('span', banner).innerHTML = escapeHtml(msg);
      banner.hidden = false;
    } catch {
      $('span', banner).textContent = 'नेटवर्क त्रुटि — कृपया इंटरनेट कनेक्शन जाँचकर पुनः प्रयास करें।';
      banner.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = submitHtml;
    }
  });
})();

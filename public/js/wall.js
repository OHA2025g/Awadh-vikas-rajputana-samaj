(function () {
  'use strict';
  const { $, $$, escapeHtml, toast, api } = window.ARVS;

  $$('[data-like]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const data = await api(`/api/wall/${btn.dataset.like}/like`, { method: 'POST' });
      btn.disabled = false;
      if (!data.ok) return toast(data.error || 'कुछ गड़बड़ हुई।');
      btn.classList.toggle('liked', data.liked);
      $('span', btn).textContent = data.likes;
    })
  );

  $$('[data-toggle-comments]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const box = $(`#comments-${btn.dataset.toggleComments}`);
      box.classList.toggle('open');
      if (box.classList.contains('open')) $('input[name="name"]', box)?.focus();
    })
  );

  $$('[data-comment-form]').forEach((form) =>
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const postId = form.dataset.commentForm;
      const payload = Object.fromEntries(new FormData(form));
      const btn = $('button', form);
      btn.disabled = true;
      const data = await api(`/api/wall/${postId}/comments`, { method: 'POST', json: payload });
      btn.disabled = false;
      if (!data.ok) return toast(data.error || 'टिप्पणी नहीं जुड़ सकी।');
      if (data.comment) {
        const c = data.comment;
        const initials = String(c.name).trim().split(/\s+/).slice(0, 2).map((p) => Array.from(p)[0]).join('');
        $('[data-comment-list]', form.parentElement).insertAdjacentHTML(
          'beforeend',
          `<div class="comment"><span class="post-avatar">${escapeHtml(initials)}</span><div class="comment-bubble"><b>${escapeHtml(c.name)}</b>${escapeHtml(c.body)}<br><small>${escapeHtml(c.when)}</small></div></div>`
        );
        const counter = $(`[data-toggle-comments="${postId}"] [data-comment-count]`);
        if (counter) counter.textContent = Number(counter.textContent) + 1;
      }
      form.elements.body.value = '';
      localStorage.setItem('arvs_comment_name', form.elements.name.value);
    })
  );

  const savedName = localStorage.getItem('arvs_comment_name');
  if (savedName) $$('[data-comment-form] input[name="name"]').forEach((i) => (i.value = savedName));

  const postForm = $('#post-form');
  if (postForm) {
    postForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#post-error');
      err.hidden = true;
      const btn = $('button[type="submit"]', postForm);
      btn.disabled = true;
      const data = await api('/wall/post', { method: 'POST', body: new FormData(postForm) });
      btn.disabled = false;
      if (!data.ok) {
        $('span', err).textContent = data.error || 'पोस्ट नहीं भेजी जा सकी।';
        err.hidden = false;
        return;
      }
      postForm.reset();
      $('#post-modal').classList.remove('open');
      toast(data.message);
    });
  }
})();

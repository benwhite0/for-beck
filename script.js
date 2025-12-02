/* Firebase-backed feeds, entries, submissions, and admin approvals */

// ESM-only: ensure HTML pages load this with <script type="module" src="script.js"></script>

import { createSearchModule } from './search.js';

// Modular imports
import {
  debounce,
  escapeHtml,
  formatDate,
  sanitizeTitle,
  parseDateValue,
  compareSubmissionsByEventDate,
  getEventDateInfo,
  formatNewsContent,
  sectionKeyToFeedId,
  sectionPage,
  sectionTitle,
  buildSectionOptions
} from './utils.js';

import {
  auth,
  db,
  ADMIN_EMAILS,
  onAuthStateChanged,
  signInAnonymously,
  updateDoc,
  deleteDoc,
  doc
} from './firebase.js';

import { ensureCompatibleImages } from './heic.js';

import { fetchSectionPosts, fetchEntryById, createSubmission } from './submissions.js';

import { memoriesState, createMemoriesModule, setupMemoriesMasonry } from './memories.js';

import { createFeedModule } from './feed.js';

import { initAdminPage } from './admin.js';

(async function(){
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Create memories module first (needs searchModule reference later)
  let searchModule;
  let memoriesModule;
  let feedModule;

  // Initialize memories module with a getter for searchModule (resolves circular dep)
  memoriesModule = createMemoriesModule({
    get searchModule() { return searchModule; },
    $$
  });

  const { renderFeedListToElement, applyMemoriesSort } = memoriesModule;

  // Initialize search module
  searchModule = createSearchModule({
    $,
    renderFeedListToElement,
    compareSubmissionsByEventDate,
    getEventDateInfo,
    parseDateValue,
    escapeHtml,
    sanitizeTitle,
    formatNewsContent,
    fetchSectionPosts,
    debounce,
    memoriesState,
    applyMemoriesSort
  });

  // Initialize feed module
  feedModule = createFeedModule({
    $,
    searchModule,
    memoriesState,
    memoriesModule
  });

  const { renderFeed, renderNewsList, sortNewsList } = feedModule;

  // Initialize memories sort buttons
  memoriesModule.initSortButtons();

  const globalSearchInput = $('#global-search-input');
  if (globalSearchInput && searchModule) {
    const globalSearchForm = $('#global-search');
    const isSearchPage = location.pathname.includes('/search/');
    searchModule.attachGlobalSearchInput(globalSearchInput, {
      formEl: globalSearchForm,
      isSearchPage
    });
  }

  // Do NOT auto sign-in anonymously here to avoid overriding Google sessions.
  
  /* ====== Mobile Nav ====== */
  const header = $('.site-header');
  const nav = $('.site-nav', header);
  const toggle = $('.nav-toggle', header);
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const expanded = nav.getAttribute('aria-expanded') === 'true';
      nav.setAttribute('aria-expanded', String(!expanded));
      toggle.setAttribute('aria-expanded', String(!expanded));
    });
    // Inject Admin link into nav (visible to everyone; auth required on page)
    const navList = nav.querySelector('.nav-list');
    if (navList && !navList.querySelector('[data-admin-link]')){
      const li = document.createElement('li');
      const base = document.baseURI || location.href;
      const url = new URL('../approve/index.html', base);
      li.innerHTML = `<a class="nav-link" href="${url.pathname}${url.search}" data-admin-link>Admin</a>`;
      navList.appendChild(li);
    }
  }

  /* ====== Mobile Search Toggle ====== */
  const mobileSearchToggle = $('.mobile-search-toggle', header);
  const globalSearch = $('.global-search', header);
  if (mobileSearchToggle && globalSearch) {
    mobileSearchToggle.addEventListener('click', () => {
      const isExpanded = globalSearch.classList.contains('is-expanded');
      globalSearch.classList.toggle('is-expanded');
      mobileSearchToggle.setAttribute('aria-expanded', String(!isExpanded));
      if (!isExpanded) {
        const searchInput = globalSearch.querySelector('input[type="search"]');
        if (searchInput) {
          setTimeout(() => searchInput.focus(), 100);
        }
      }
    });
    document.addEventListener('click', (e) => {
      if (!globalSearch.contains(e.target) && !mobileSearchToggle.contains(e.target)) {
        globalSearch.classList.remove('is-expanded');
        mobileSearchToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }
  
  /* ====== Modal (optional submit modal on some pages) ====== */
  const modal = $('#submission-modal');
  const modalForm = $('#submission-form');
  function openModal() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'false');
    const first = modal.querySelector('input, textarea, button');
    first && first.focus();
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }
  $$('[data-open-modal]').forEach(btn =>
    btn.addEventListener('click', e => {
      const sectionKey = e.currentTarget.getAttribute('data-section') || 'memories';
      if (modalForm) {
        modalForm.dataset.sectionKey = sectionKey;
        modalForm.dataset.targetFeed = sectionKeyToFeedId(sectionKey);
      }
      openModal();
    })
  );
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));
  document.addEventListener('keydown', e => e.key === 'Escape' && closeModal());
  
  // Ensure anonymous auth only on submission pages (not on admin page)
  if ((modalForm || $('#moderated-form')) && !auth.currentUser) {
    try { await signInAnonymously(auth); } catch {}
  }

  /* ====== Captcha helpers ====== */
  function captchaResponse() {
    if (window.grecaptcha && typeof window.grecaptcha.getResponse === 'function') {
      return window.grecaptcha.getResponse();
    }
    return '';
  }
  function resetCaptcha() {
    if (window.grecaptcha && typeof window.grecaptcha.reset === 'function') {
      window.grecaptcha.reset();
    }
  }
  let submitFormButton;
  window.beckRecaptchaSolved = function(){
    if (submitFormButton) submitFormButton.disabled = false;
  };
  window.beckRecaptchaExpired = function(){
    resetCaptcha();
    if (submitFormButton) submitFormButton.disabled = true;
  };

  /* ====== Entry Page Rendering ====== */
  async function renderEntryPage() {
    const entryContainer = $('#entry-container');
    if (!entryContainer) return;
    const params = new URLSearchParams(location.search);
    const hashParams = new URLSearchParams((location.hash || '').replace(/^#/,''));
    const section = params.get('section') || hashParams.get('section') || 'memories';
    const id = params.get('id') || hashParams.get('id');
    if (!id) return;
    const post = await fetchEntryById(id);
    if (!post) {
      entryContainer.innerHTML = '<p>Entry not found.</p>';
      return;
    }
  
    const crumbNav = $('#breadcrumb');
    if (crumbNav) {
      const sectionHref = sectionPage(section);
      const sectionName = sectionTitle(section);
      const safeTitle = escapeHtml(post.title && String(post.title).trim() ? String(post.title).trim() : sanitizeTitle(post.content));
      crumbNav.innerHTML = `
        <a href="${sectionHref}">${sectionName}</a>
        <span class="breadcrumb-sep"></span>
        <span>${safeTitle}</span>
      `;
    }
  
    let mediaHtml = '';
    if (post.mediaURL) {
      if (post.mediaType?.startsWith('image/')) {
        mediaHtml = `<div class="entry-media"><img alt="" src="${post.mediaURL}" loading="eager" /></div>`;
      } else if (post.mediaType?.startsWith('video/')) {
        mediaHtml = `<div class="entry-media"><video controls src="${post.mediaURL}" preload="metadata"></video></div>`;
      } else if (post.mediaType?.startsWith('audio/')) {
        mediaHtml = `<div class="entry-media"><audio controls src="${post.mediaURL}" preload="metadata"></audio></div>`;
      }
    }
    const eventDate = post.eventDate ? `<p class="muted small">Event date: ${formatDate(post.eventDate)}</p>` : '';
    const credits = post.credits ? `<p class="muted small">Credits: ${escapeHtml(post.credits)}</p>` : '';
  
    const postedISO = post.postedAt?.toDate ? post.postedAt.toDate().toISOString() : (post.postedAt || new Date().toISOString());
    entryContainer.innerHTML = `
      ${mediaHtml}
      <div class="entry-meta small muted">
        <time datetime="${postedISO}">${formatDate(postedISO)}</time> •
        ${escapeHtml(post.author || 'Anonymous')}
      </div>
      <h1 class="h1 entry-title">${escapeHtml(post.title && String(post.title).trim() ? String(post.title).trim() : sanitizeTitle(post.content))}</h1>
      ${credits}
      ${eventDate}
      <div class="entry-body"><p>${escapeHtml(post.content)}</p></div>
      <div id="entry-admin-controls"></div>
      <p><a href="${sectionPage(section)}" class="btn btn-ghost">← Back to ${sectionTitle(section)}</a></p>
    `;
    ensureCompatibleImages(entryContainer);

    // Admin controls for editing/deleting verified items
    const controls = document.getElementById('entry-admin-controls');
    function renderAdminControls(user){
      if (!controls) return;
      if (!user || user.isAnonymous || !ADMIN_EMAILS.includes(user.email || '')) {
        controls.innerHTML = '';
        return;
      }
      const sectionOptions = buildSectionOptions(section);
      const safeContent = escapeHtml(post.content || '');
      controls.innerHTML = `
        <div class="panel" style="margin-top:1rem">
          <div class="form-actions" style="gap:0.5rem;margin-bottom:0.75rem">
            <button class="btn" id="entry-edit-btn">Edit</button>
            <button class="btn btn-ghost" id="entry-delete-btn">Delete</button>
          </div>
          <form id="entry-edit-form" hidden>
            <div class="form-grid">
              <label class="field field-wide"><span>Title</span><input name="title" value="${escapeHtml(post.title || '')}"></label>
              <label class="field field-wide"><span>Content</span><textarea name="content" rows="6">${safeContent}</textarea></label>
              <label class="field"><span>Author</span><input name="author" value="${escapeHtml(post.author || '')}"></label>
              <label class="field"><span>Credits</span><input name="credits" value="${escapeHtml(post.credits || '')}"></label>
              <label class="field"><span>Date</span><input type="date" name="eventDate" value="${post.eventDate || ''}"></label>
              <label class="field"><span>Section</span><select name="section">${sectionOptions}</select></label>
            </div>
            <div class="form-actions" style="gap:0.5rem;margin-top:0.75rem">
              <button class="btn" data-save>Save</button>
              <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
            </div>
          </form>
        </div>`;

      const editBtn = document.getElementById('entry-edit-btn');
      const deleteBtn = document.getElementById('entry-delete-btn');
      const form = document.getElementById('entry-edit-form');
      editBtn?.addEventListener('click', () => { if (form) form.hidden = false; });
      form?.querySelector('[data-cancel]')?.addEventListener('click', () => { if (form) form.hidden = true; });
      form?.querySelector('[data-save]')?.addEventListener('click', async e => {
        e.preventDefault();
        if (!form) return;
        const fd = new FormData(form);
        const updates = {
          title: String(fd.get('title') || '').trim(),
          content: String(fd.get('content') || '').trim(),
          author: String(fd.get('author') || '').trim(),
          credits: String(fd.get('credits') || '').trim(),
          eventDate: String(fd.get('eventDate') || ''),
          section: String(fd.get('section') || section)
        };
        try {
          await updateDoc(doc(db, 'submissions', id), updates);
          location.reload();
        } catch(err) {
          alert('Save failed.');
          console.error(err);
        }
      });
      deleteBtn?.addEventListener('click', async () => {
        if (!confirm('Delete this entry?')) return;
        try {
          await deleteDoc(doc(db, 'submissions', id));
          location.href = sectionPage(section);
        } catch(err) {
          alert('Delete failed.');
          console.error(err);
        }
      });
    }
    if (auth.currentUser) renderAdminControls(auth.currentUser);
    onAuthStateChanged(auth, user => renderAdminControls(user));
  }
  
  /* ====== Initial Rendering ====== */
  await Promise.all([
    renderFeed('memories', $('#feed-memories')),
    renderFeed('actions', $('#feed-actions')),
    renderFeed('silver', $('#feed-silver'))
  ]);
  await renderNewsList();
  await renderEntryPage();
  sortNewsList();
  
  /* ====== 2022 and beyond view toggle ====== */
  const viewToggleButtons = $$('[data-view-toggle]');
  const viewPanels = $$('[data-view-panel]');
  if (viewToggleButtons.length && viewPanels.length) {
    const setView = (target, skipHashUpdate = false) => {
      const normalized = target === 'list' ? 'list' : 'gallery';
      viewToggleButtons.forEach(btn => {
        const isMatch = btn.getAttribute('data-view-toggle') === normalized;
        btn.classList.toggle('is-active', isMatch);
        btn.setAttribute('aria-pressed', String(isMatch));
      });
      viewPanels.forEach(panel => {
        const isMatch = panel.getAttribute('data-view-panel') === normalized;
        panel.hidden = !isMatch;
        panel.classList.toggle('is-active', isMatch);
      });
      if (normalized === 'gallery') {
        const galleryGrid = document.getElementById('feed-actions');
        if (galleryGrid) setupMemoriesMasonry(galleryGrid);
      }
      if (!skipHashUpdate) {
        const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
        hashParams.set('view', normalized);
        const nextHash = hashParams.toString();
        if (nextHash) {
          location.hash = nextHash;
        } else {
          history.replaceState(null, document.title, location.pathname + location.search);
        }
      }
    };

    viewToggleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.getAttribute('data-view-toggle') || 'gallery';
        setView(target);
      });
    });

    const applyViewFromHash = () => {
      const hashParams = new URLSearchParams((location.hash || '').replace(/^#/, ''));
      const view = hashParams.get('view') || 'gallery';
      setView(view, true);
    };
    window.addEventListener('hashchange', applyViewFromHash);
    applyViewFromHash();
  }

  /* ====== Form error helpers ====== */
  function resetErrors(form) { $$('.error', form).forEach(el => el.textContent = ''); }
  function setError(form, name, msg) {
    const el = form.querySelector(`[data-error-for="${name}"]`);
    if (el) el.textContent = msg;
  }
  function getSubmissionErrorMessage(err, fallback) {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
    return fallback;
  }

  /* ====== Public Submit (modal form if present) ====== */
  if (modalForm) {
    modalForm.addEventListener('submit', async e => {
      e.preventDefault();
      const author = modalForm.author.value.trim();
      const emailInput = modalForm.email;
      const email = emailInput ? emailInput.value.trim() : '';
      const title = (modalForm.title?.value || '').trim();
      const content = modalForm.content.value.trim();
      const credits = modalForm.credits.value.trim();
      const eventDate = modalForm.eventDate.value || '';
      resetErrors(modalForm);
      let valid = true;
      if (!author) { setError(modalForm, 'author', 'Please enter a name'); valid = false; }
      if (emailInput) {
        if (!email) {
          setError(modalForm, 'email', 'Please enter your email');
          valid = false;
        } else {
          const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
          if (!emailPattern.test(email)) {
            setError(modalForm, 'email', 'Please enter a valid email');
            valid = false;
          }
        }
      }
      if (!content) { setError(modalForm, 'content', 'Please write something'); valid = false; }
      if (!valid) return;
      const file = modalForm.media?.files?.[0];
      const section = modalForm.dataset.sectionKey || 'memories';
      // Progress UI
      let progressWrap = modalForm.querySelector('.upload-progress');
      if (!progressWrap) {
        progressWrap = document.createElement('div');
        progressWrap.className = 'upload-progress muted small';
        progressWrap.style.marginTop = '0.5rem';
        progressWrap.innerHTML = '<progress max="100" value="0"></progress> <span>Uploading…</span>';
        modalForm.appendChild(progressWrap);
      }
      const progressEl = progressWrap.querySelector('progress');
      try {
        await createSubmission({ author, email, credits, section, eventDate, title, content, file }, pct => {
          if (progressEl) progressEl.value = pct;
        });
        modalForm.reset();
        closeModal();
        alert('Thank you! We\'ll let you know when it\'s posted.');
      } catch (err) {
        const message = getSubmissionErrorMessage(err, 'Submission failed. Please try again.');
        alert(message);
        console.error(err);
      } finally {
        if (progressWrap) progressWrap.remove();
      }
    });
  }

  /* ====== Submit Page (submit/) ====== */
  const pageForm = $('#moderated-form');
  if (pageForm) {
    submitFormButton = pageForm.querySelector('button[type="submit"]');
    if (pageForm.querySelector('.g-recaptcha') && submitFormButton) {
      submitFormButton.disabled = true;
    }
    pageForm.addEventListener('submit', async e => {
      e.preventDefault();
      const author = pageForm.author.value.trim();
      const email = pageForm.email.value.trim();
      const title = (pageForm.title?.value || '').trim();
      const credits = pageForm.credits.value.trim();
      const section = pageForm.section.value;
      const eventDate = pageForm.eventDate.value || '';
      const content = pageForm.content.value.trim();
      const file = pageForm.media?.files?.[0];
      const setErrorEl = (name, msg) => {
        const el = pageForm.querySelector(`[data-error-for="${name}"]`);
        if (el) el.textContent = msg || '';
      };
      ['author','email','content','section'].forEach(n => setErrorEl(n, ''));
      let valid = true;
      if (!author){ setErrorEl('author','Please enter your name'); valid = false; }
      if (!email){
        setErrorEl('email','Please enter your email');
        valid = false;
      } else {
        const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
        if (!emailPattern.test(email)) {
          setErrorEl('email','Please enter a valid email');
          valid = false;
        }
      }
      if (!section){ setErrorEl('section','Please choose a section'); valid = false; }
      if (!content){ setErrorEl('content','Please add your entry'); valid = false; }
      if (!valid) return;
      if (pageForm.querySelector('.g-recaptcha')) {
        const token = captchaResponse();
        if (!token) {
          alert('Please complete the reCAPTCHA before submitting.');
          return;
        }
      }
      // Progress UI
      let progressWrap = pageForm.querySelector('.upload-progress');
      if (!progressWrap) {
        progressWrap = document.createElement('div');
        progressWrap.className = 'upload-progress muted small';
        progressWrap.style.marginTop = '0.5rem';
        progressWrap.innerHTML = '<progress max="100" value="0"></progress> <span>Uploading…</span>';
        pageForm.appendChild(progressWrap);
      }
      const progressEl = progressWrap.querySelector('progress');
      try {
        await createSubmission({ author, email, credits, section, eventDate, title, content, file }, pct => {
          if (progressEl) progressEl.value = pct;
        });
        pageForm.reset();
        resetCaptcha();
        if (submitFormButton) submitFormButton.disabled = true;
        alert("Thank you! We'll let you know when it's posted.");
      } catch (err) {
        const message = getSubmissionErrorMessage(err, 'Submission failed. Please try again.');
        alert(message);
        console.error(err);
      } finally {
        if (progressWrap) progressWrap.remove();
      }
    });
  }

  /* ====== Admin Approvals (approve.html) ====== */
  initAdminPage({ $ });

  /* ====== Static hero image ====== */
  (function setHeroImage(){
    const img = document.getElementById('hero-image');
    if (!img) return;
    if (!img.getAttribute('src')) img.remove();
  })();
})();

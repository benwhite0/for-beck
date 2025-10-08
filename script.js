/* Handles nav, modal, validation, localStorage posts, and per-entry pages */

(function () {
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  
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
    }
  
    /* ====== Modal ====== */
    const modal = $('#submission-modal');
    const form = $('#submission-form');
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
        if (form) {
          form.dataset.sectionKey = sectionKey;
          form.dataset.targetFeed = sectionKeyToFeedId(sectionKey);
        }
        openModal();
      })
    );
    $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', closeModal));
    document.addEventListener('keydown', e => e.key === 'Escape' && closeModal());
  
    function sectionKeyToFeedId(key) {
      switch (key) {
        case 'memories': return 'feed-memories';
        case 'actions': return 'feed-actions';
        case 'silver': return 'feed-silver';
        default: return 'feed-memories';
      }
    }
  
    /* ====== Local Storage ====== */
    const STORAGE_KEY = 'for-beck-posts';
    function loadAll() {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
      catch { return {}; }
    }
    function saveAll(db) { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); }
    function addPost(section, post) {
      const db = loadAll();
      db[section] = db[section] || [];
      db[section].unshift(post);
      saveAll(db);
    }
    function getPosts(section) {
      const db = loadAll();
      return db[section] || [];
    }
    function getPost(section, id) {
      return getPosts(section).find(p => p.id === id);
    }
  
    /* ====== Feed Rendering ====== */
    function renderFeed(section, feedEl) {
      if (!feedEl) return;
      const list = getPosts(section);
      const emptyMsg = document.querySelector(`[data-empty-for="${section}"]`);
      if (!list.length) {
        if (emptyMsg) emptyMsg.style.display = 'block';
        feedEl.innerHTML = '';
        return;
      }
      if (emptyMsg) emptyMsg.style.display = 'none';
  
      feedEl.innerHTML = list.map(item => {
        const mediaHtml = item.mediaPreview
          ? `<div class="card-media"><img alt="" src="${item.mediaPreview}" /></div>`
          : `<div class="card-media" aria-hidden="true"></div>`;
        const title = sanitizeTitle(item.content);
        const link = `entry.html?id=${encodeURIComponent(item.id)}&section=${encodeURIComponent(section)}`;
        return `
          <li class="card" role="article">
            <a href="${link}" class="card-link-wrap">
              ${mediaHtml}
              <div class="card-body">
                <div class="card-meta">
                  <span>${escapeHtml(item.author || 'Anonymous')}</span>
                  <span>•</span>
                  <time datetime="${item.postedISO}">${formatDate(item.postedISO)}</time>
                </div>
                <h3 class="card-title">${escapeHtml(title)}</h3>
              </div>
            </a>
          </li>`;
      }).join('');
    }
  
    /* ====== Entry Page Rendering ====== */
    function renderEntryPage() {
        const entryContainer = $('#entry-container');
        if (!entryContainer) return;
      
        const params = new URLSearchParams(location.search);
        const section = params.get('section');
        const id = params.get('id');
        if (!section || !id) return;
      
        const post = getPost(section, id);
        if (!post) {
          entryContainer.innerHTML = '<p>Entry not found.</p>';
          return;
        }
      
        // Breadcrumb
        const crumbNav = $('#breadcrumb');
        if (crumbNav) {
          const sectionHref = sectionPage(section);
          const sectionName = sectionTitle(section);
          const safeTitle = escapeHtml(sanitizeTitle(post.content));
          crumbNav.innerHTML = `
            <a href="${sectionHref}">${sectionName}</a>
            <span class="breadcrumb-sep"></span>
            <span>${safeTitle}</span>
          `;
        }
      
        // Main entry content
        const mediaHtml = post.mediaPreview
          ? `<div class="entry-media"><img alt="" src="${post.mediaPreview}" /></div>`
          : '';
        const eventDate = post.eventDate ? `<p class="muted small">Event date: ${formatDate(post.eventDate)}</p>` : '';
        const credits = post.credits ? `<p class="muted small">Credits: ${escapeHtml(post.credits)}</p>` : '';
      
        entryContainer.innerHTML = `
          ${mediaHtml}
          <div class="entry-meta small muted">
            <time datetime="${post.postedISO}">${formatDate(post.postedISO)}</time> •
            ${escapeHtml(post.author || 'Anonymous')}
          </div>
          <h1 class="h1 entry-title">${escapeHtml(sanitizeTitle(post.content))}</h1>
          ${credits}
          ${eventDate}
          <div class="entry-body"><p>${escapeHtml(post.content)}</p></div>
          <p><a href="${sectionPage(section)}" class="btn btn-ghost">← Back to ${sectionTitle(section)}</a></p>
        `;
      }
      
  
    function sectionPage(key) {
      switch (key) {
        case 'memories': return 'nineteen-years.html';
        case 'actions': return 'action-for-change.html';
        case 'silver': return 'support.html';
        default: return 'index.html';
      }
    }
    function sectionTitle(key) {
      switch (key) {
        case 'memories': return '19 Years';
        case 'actions': return 'Action for Change';
        case 'silver': return 'Silver Threads';
        default: return 'Home';
      }
    }
  
    /* ====== Utilities ====== */
    function formatDate(iso) {
      try {
        const d = new Date(iso);
        return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
      } catch { return iso; }
    }
    function sanitizeTitle(text) {
      const t = (text || '').trim().replace(/\s+/g, ' ');
      if (t.length <= 80) return t;
      return t.slice(0, 77) + '…';
    }
    function escapeHtml(str) {
      return String(str || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }
  
    /* ====== News & Events Sorting ====== */
    function sortNewsList() {
      const list = document.getElementById('news-list');
      if (!list) return;
      const items = Array.from(list.children);
      items.sort((a, b) => {
        const ad = new Date(a.querySelector('time')?.getAttribute('datetime') || 0);
        const bd = new Date(b.querySelector('time')?.getAttribute('datetime') || 0);
        return bd - ad; // newest first
      });
      items.forEach(item => list.appendChild(item));
    }
  
    /* ====== Initial Feed Rendering ====== */
    renderFeed('memories', $('#feed-memories'));
    renderFeed('actions', $('#feed-actions'));
    renderFeed('silver', $('#feed-silver'));
    renderEntryPage();
    sortNewsList();
  
    /* ====== Form Handling ====== */
    if (form) {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const author = form.author.value.trim();
        const content = form.content.value.trim();
        const credits = form.credits.value.trim();
        const eventDate = form.eventDate.value || '';
        resetErrors(form);
        let valid = true;
        if (!author) { setError('author', 'Please enter a name'); valid = false; }
        if (!content) { setError('content', 'Please write something'); valid = false; }
        if (!valid) return;
  
        let mediaPreview = '';
        const file = form.media?.files?.[0];
        if (file && file.type.startsWith('image/')) {
          mediaPreview = await fileToDataURL(file);
        }
  
        const post = {
          id: crypto.randomUUID(),
          author,
          credits,
          content,
          eventDate,
          postedISO: new Date().toISOString(),
          mediaPreview
        };
  
        const section = form.dataset.sectionKey || 'memories';
        addPost(section, post);
        renderFeed(section, document.getElementById(form.dataset.targetFeed));
        form.reset();
        closeModal();
      });
    }
  
    function resetErrors(form) { $$('.error', form).forEach(el => el.textContent = ''); }
    function setError(name, msg) {
      const el = $(`[data-error-for="${name}"]`, form);
      if (el) el.textContent = msg;
    }
    function fileToDataURL(file) {
      return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
    }
  
    /* ====== Hero Image Upload (Index) ====== */
    (function initHeroUpload(){
      const panel = document.getElementById('hero-image-panel');
      if (!panel) return; // only on index page
      const img = document.getElementById('hero-image');
      const trigger = document.getElementById('hero-upload-trigger');
      const input = document.getElementById('hero-upload-input');
      const removeBtn = document.getElementById('hero-remove-btn');
      const KEY = 'for-beck-hero-image';
  
      function applyImage(dataUrl){
        if (!img) return;
        if (dataUrl) {
          img.src = dataUrl;
          img.style.display = 'block';
          trigger.style.display = 'none';
          removeBtn.style.display = 'block';
        } else {
          img.removeAttribute('src');
          img.style.display = 'none';
          trigger.style.display = 'flex';
          removeBtn.style.display = 'none';
        }
      }
  
      // Load saved image
      try {
        const saved = localStorage.getItem(KEY);
        if (saved) applyImage(saved);
        else applyImage('');
      } catch { /* ignore */ }
  
      trigger?.addEventListener('click', () => input?.click());
      input?.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        // Read as data URL; let the browser downscale visually via object-fit for quality
        const dataUrl = await fileToDataURL(file);
        applyImage(dataUrl);
        try { localStorage.setItem(KEY, dataUrl); } catch { /* ignore */ }
      });
      removeBtn?.addEventListener('click', () => {
        applyImage('');
        try { localStorage.removeItem(KEY); } catch { /* ignore */ }
      });
    })();
  })();
  
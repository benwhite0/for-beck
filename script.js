/* Firebase-backed feeds, entries, submissions, and admin approvals */

// ESM-only: ensure HTML pages load this with <script type="module" src="script.js"></script>

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js';
import { getAuth, onAuthStateChanged, signInAnonymously, signOut, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js';
import { getFirestore, collection, addDoc, getDoc, getDocs, doc, query, where, orderBy, limit, updateDoc, deleteDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js';
import { getStorage, ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js';

(async function(){
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const HEIC_EXT_RE = /\.(heic|heif)(?:$|[?#])/i;
  let heicLoaderPromise;

  const renameWithExt = (name = 'image', ext) => {
    const base = String(name || '').replace(/\.[^/.]+$/, '');
    return `${base || 'image'}${ext}`;
  };

  async function loadHeic2Any(){
    if (window.heic2any) return;
    if (!heicLoaderPromise) {
      heicLoaderPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js';
        script.async = true;
        script.onload = resolve;
        script.onerror = () => {
          heicLoaderPromise = undefined;
          reject(new Error('Failed to load HEIC converter'));
        };
        document.head.appendChild(script);
      });
    }
    await heicLoaderPromise;
  }

  async function convertHeicFile(file){
    const looksHeic = /image\/(heic|heif)/i.test(file?.type || '') || HEIC_EXT_RE.test(file?.name || '');
    if (!looksHeic || !file) return file;
    try {
      await loadHeic2Any();
      try {
        const webpBlob = await window.heic2any({ blob: file, toType: 'image/webp', quality: 0.86 });
        return new File([webpBlob], renameWithExt(file.name, '.webp'), { type: 'image/webp' });
      } catch {
        const jpgBlob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 });
        return new File([jpgBlob], renameWithExt(file.name, '.jpg'), { type: 'image/jpeg' });
      }
    } catch {
      return file;
    }
  }

  function ensureCompatibleImages(root = document){
    root.querySelectorAll('img').forEach(img => {
      const src = img.getAttribute('src') || '';
      if (HEIC_EXT_RE.test(src)) convertImageElement(img);
      else img.addEventListener('error', () => convertImageElement(img), { once: true });
    });
  }

  async function convertImageElement(img){
    if (!img || img.dataset.heicConverted === '1') return;
    const src = img.getAttribute('src');
    if (!src) return;
    img.dataset.heicConverted = '1';
    try {
      await loadHeic2Any();
      const res = await fetch(src, { mode: 'cors' });
      const blob = await res.blob();
      const looksHeic = /image\/(heic|heif)/i.test(blob.type || '') || HEIC_EXT_RE.test(src);
      if (!looksHeic) {
        img.dataset.heicConverted = '';
        return;
      }
      let converted;
      try {
        converted = await window.heic2any({ blob, toType: 'image/webp', quality: 0.86 });
      } catch {
        converted = await window.heic2any({ blob, toType: 'image/jpeg', quality: 0.88 });
      }
      const nextSrc = URL.createObjectURL(converted);
      const prevSrc = img.dataset.heicObjectUrl;
      if (prevSrc) URL.revokeObjectURL(prevSrc);
      img.dataset.heicObjectUrl = nextSrc;
      img.src = nextSrc;
      img.addEventListener('load', () => {
        const current = img.dataset.heicObjectUrl;
        if (current) {
          URL.revokeObjectURL(current);
          delete img.dataset.heicObjectUrl;
        }
      }, { once: true });
    } catch {
      img.dataset.heicConverted = '';
    }
  }

  /* ====== Firebase Init ====== */
  const firebaseConfig = {
    apiKey: "AIzaSyChj8gAgnTq2H2YGMd0iHI4W44ztidh9K8",
    authDomain: "beck-742dc.firebaseapp.com",
    projectId: "beck-742dc",
    storageBucket: "beck-742dc.firebasestorage.app",
    messagingSenderId: "43212058207",
    appId: "1:43212058207:web:42c193dc771e51124ab5ea",
    measurementId: "G-59NXN5V5JM"
  };
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const storage = getStorage(app);
  const ADMIN_EMAILS = ['benjaminwhite02@gmail.com', 'fran@scabetti.co.uk', 'test@beck.com', 'beckbromleyunited@gmail.com'];
  const isAdminUser = (user) => !!(user && !user.isAnonymous && ADMIN_EMAILS.includes(user.email || ''));

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
  
    function sectionKeyToFeedId(key) {
      switch (key) {
        case 'memories': return 'feed-memories';
        case 'actions': return 'feed-actions';
        case 'silver': return 'feed-silver';
        case 'news': return 'news-list';
        default: return 'feed-memories';
      }
    }
  
  /* ====== Firestore Queries ====== */
  async function fetchSectionPosts(section) {
    const q = query(
      collection(db, 'submissions'),
      where('section', '==', section),
      where('verified', '==', true),
      orderBy('postedAt', 'desc'),
      limit(100)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }

  // Ensure anonymous auth only on submission pages (not on admin page)
  if ((modalForm || $('#moderated-form')) && !auth.currentUser) {
    try { await signInAnonymously(auth); } catch {}
  }

  async function fetchEntryById(id) {
    const d = await getDoc(doc(db, 'submissions', id));
    if (!d.exists()) return null;
    const data = d.data();
    if (!data.verified) return null;
    return { id: d.id, ...data };
  }

  // Client-side image compression (iPad/desktop-friendly)
  async function compressImageIfNeeded(file) {
    try {
      if (!file || !file.type?.startsWith('image/')) return file;
      const converted = await convertHeicFile(file);
      if (converted !== file) return converted;
      if (/image\/(heic|heif)/i.test(file.type || '') || HEIC_EXT_RE.test(file.name || '')) return file;
      // Read into image
      const dataUrl = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      const img = new Image();
      const loadP = new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
      img.src = dataUrl;
      await loadP;
      const maxDim = 2000; // max width/height
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      const targetW = Math.max(1, Math.round(width * scale));
      const targetH = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(img, 0, 0, targetW, targetH);
      const quality = 0.82;
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
      if (!blob) return file;
      // If compression didn’t help, keep original
      if (blob.size >= file.size) return file;
      return new File([blob], (file.name || 'image')
        .replace(/\.(heic|heif|png|webp|jpg|jpeg)$/i, '') + '.jpg', { type: 'image/jpeg' });
    } catch {
      return file; // fall back safely
    }
  }

  async function uploadMedia(file, section, onProgress) {
    if (!file) return { mediaURL: '', mediaType: '' };
    // Prepare file: compress images; enforce size/type limits
    let prepared = file;
    if (file.type?.startsWith('image/')) {
      prepared = await compressImageIfNeeded(file);
    }
    const MAX_BYTES = 10 * 1024 * 1024; // 10MB safeguard (mirrors rules)
    if (prepared.size > MAX_BYTES) {
      throw new Error('File too large. Please choose a file under 10 MB.');
    }

    const fileName = `${Date.now()}-${prepared.name}`;
    const path = `submissions/${auth.currentUser?.uid || 'anon'}/${section}/${fileName}`;
    const ref = storageRef(storage, path);
    // Track progress (works on iPad/desktop)
    if (onProgress) {
      const task = uploadBytesResumable(ref, prepared, { contentType: prepared.type });
      await new Promise((resolve, reject) => {
        task.on('state_changed', snap => {
          try {
            const pct = Math.round((snap.bytesTransferred / Math.max(1, snap.totalBytes)) * 100);
            onProgress(pct);
          } catch {}
        }, reject, resolve);
      });
    } else {
      await uploadBytes(ref, prepared, { contentType: prepared.type });
    }
    const url = await getDownloadURL(ref);
    return { mediaURL: url, mediaType: prepared.type };
  }

  async function createSubmission({ author, email = '', credits, section, eventDate, title, content, file }, onProgress) {
    const { mediaURL, mediaType } = await uploadMedia(file, section, onProgress);
    const payload = {
      author,
      email: email.trim(),
      credits,
      section,
      eventDate: eventDate || '',
      title: (title || '').trim(),
      content,
      mediaURL,
      mediaType,
      verified: false,
      postedAt: serverTimestamp()
    };
    const ref = await addDoc(collection(db, 'submissions'), payload);
    return ref.id;
  }

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

  async function approveSubmission(id) {
    await updateDoc(doc(db, 'submissions', id), { verified: true });
  }

  /* ====== Feed Rendering (uses Firestore) ====== */
  async function renderFeed(section, feedEl) {
      if (!feedEl) return;
    feedEl.setAttribute('aria-busy', 'true');
    const list = await fetchSectionPosts(section);
      const emptyMsg = document.querySelector(`[data-empty-for="${section}"]`);
      if (!list.length) {
        if (emptyMsg) emptyMsg.style.display = 'block';
        feedEl.innerHTML = '';
      feedEl.setAttribute('aria-busy', 'false');
        return;
      }
      if (emptyMsg) emptyMsg.style.display = 'none';

      const sortedList = list.slice().sort(compareSubmissionsByEventDate);

      feedEl.innerHTML = sortedList.map(item => {
      const eventInfo = getEventDateInfo(item.eventDate);
      const metaPieces = [`<span>${escapeHtml(item.author || 'Anonymous')}</span>`];
      if (eventInfo) {
        metaPieces.push('<span>•</span>');
        metaPieces.push(`<time datetime="${escapeHtml(eventInfo.datetime)}">${escapeHtml(eventInfo.display)}</time>`);
      }
      const metaHtml = metaPieces.join('');
      let mediaHtml = '';
      if (item.mediaURL) {
          if (item.mediaType?.startsWith('image/')) {
          mediaHtml = `<div class="card-media"><img alt="" src="${item.mediaURL}" /></div>`;
          } else if (item.mediaType?.startsWith('video/')) {
          mediaHtml = `<div class="card-media"><video controls src="${item.mediaURL}"></video></div>`;
          } else if (item.mediaType?.startsWith('audio/')) {
          mediaHtml = `<div class="card-media"><audio controls src="${item.mediaURL}"></audio></div>`;
          }
        }
      const displayTitle = (item.title && String(item.title).trim()) ? String(item.title).trim() : sanitizeTitle(item.content);
      const u = new URL('../entry/', document.baseURI);
      u.searchParams.set('id', item.id);
      u.searchParams.set('section', section);
      const link = `${u.pathname}${u.search}#id=${encodeURIComponent(item.id)}&section=${encodeURIComponent(section)}`;
        return `
          <li class="card" role="article">
            <a href="${link}" class="card-link-wrap">
              ${mediaHtml}
              <div class="card-body">
                <div class="card-meta">
                  ${metaHtml}
                </div>
              <h3 class="card-title">${escapeHtml(displayTitle)}</h3>
              </div>
            </a>
          </li>`;
      }).join('');
    feedEl.setAttribute('aria-busy', 'false');
    ensureCompatibleImages(feedEl);
    }
  
  function formatNewsContent(text) {
    return escapeHtml(text || '').replace(/\n{2,}/g, '\n\n').split('\n\n').map(
      block => `<p>${block.replace(/\n/g, '<br />')}</p>`
    ).join('').replace(/(<p><\/p>)+/g, '');
  }

  async function renderNewsList() {
    const listEl = document.getElementById('news-list');
    if (!listEl) return;
    const posts = await fetchSectionPosts('news');
    listEl.querySelectorAll('.js-news-dynamic').forEach(node => node.remove());
    if (!posts.length) return;
    const sortedPosts = posts.slice().sort(compareSubmissionsByEventDate);
    const fragment = document.createDocumentFragment();
    sortedPosts.forEach(item => {
      const li = document.createElement('li');
      li.className = 'js-news-dynamic';
      const eventInfo = getEventDateInfo(item.eventDate);
      const dateHtml = eventInfo
        ? `<time class="news-date" datetime="${escapeHtml(eventInfo.datetime)}">${escapeHtml(eventInfo.display)}</time>`
        : '';
      li.innerHTML = `
        <div class="news-item${eventInfo ? '' : ' news-item--no-date'}">
          ${dateHtml}
          <div class="news-body">
            <h3 class="h3">${escapeHtml(item.title && String(item.title).trim() ? String(item.title).trim() : sanitizeTitle(item.content))}</h3>
            ${formatNewsContent(item.content)}
          </div>
        </div>
      `;
      fragment.appendChild(li);
    });
    listEl.appendChild(fragment);
  }

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
        mediaHtml = `<div class="entry-media"><img alt="" src="${post.mediaURL}" /></div>`;
          } else if (post.mediaType?.startsWith('video/')) {
        mediaHtml = `<div class="entry-media"><video controls src="${post.mediaURL}"></video></div>`;
          } else if (post.mediaType?.startsWith('audio/')) {
        mediaHtml = `<div class="entry-media"><audio controls src="${post.mediaURL}"></audio></div>`;
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
          const sectionOptions = `
            <option value="memories" ${section==='memories'?'selected':''}>19 Years</option>
            <option value="actions" ${section==='actions'?'selected':''}>Action for Change</option>
            <option value="silver" ${section==='silver'?'selected':''}>Silver Threads</option>
            <option value="news" ${section==='news'?'selected':''}>News &amp; Events</option>`;
          const safeContent = escapeHtml(post.content || '');
          controls.innerHTML = `
            <div class="panel" style="margin-top:1rem">
              <div class="form-actions" style="gap:0.5rem;margin-bottom:0.75rem">
                <button class="btn" id="entry-edit-btn">Edit</button>
                <button class="btn btn-ghost" id="entry-delete-btn">Delete</button>
              </div>
              <form id="entry-edit-form" hidden>
                <div class="form-grid">
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
  
    function sectionPage(key) {
      switch (key) {
        case 'memories': return '../nineteen-years/';
        case 'actions': return '../action-for-change/';
        case 'silver': return '../support/';
        case 'news': return '../news-events/';
        default: return '../home/';
      }
    }
    function sectionTitle(key) {
      switch (key) {
        case 'memories': return '19 Years';
        case 'actions': return 'Action for Change';
        case 'silver': return 'Silver Threads';
        case 'news': return 'News & Events';
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
    function parseDateValue(value) {
      if (!value) return null;
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? time : null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const time = Date.parse(trimmed);
        return Number.isNaN(time) ? null : time;
      }
      if (typeof value === 'object') {
        if (typeof value.toDate === 'function') {
          const d = value.toDate();
          const time = d?.getTime?.();
          return Number.isFinite(time) ? time : null;
        }
        if (typeof value.toMillis === 'function') {
          const time = value.toMillis();
          return Number.isFinite(time) ? time : null;
        }
        if (typeof value.seconds === 'number') {
          const time = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
          return Number.isFinite(time) ? time : null;
        }
      }
      return null;
    }
    function compareSubmissionsByEventDate(a, b) {
      const aEvent = parseDateValue(a?.eventDate);
      const bEvent = parseDateValue(b?.eventDate);
      const aHasEvent = aEvent !== null;
      const bHasEvent = bEvent !== null;
      if (aHasEvent && bHasEvent && bEvent !== aEvent) return bEvent - aEvent;
      if (aHasEvent !== bHasEvent) return aHasEvent ? 1 : -1;
      const aPosted = parseDateValue(a?.postedAt);
      const bPosted = parseDateValue(b?.postedAt);
      if (aPosted !== null && bPosted !== null && bPosted !== aPosted) return bPosted - aPosted;
      if (aPosted !== null && bPosted === null) return -1;
      if (aPosted === null && bPosted !== null) return 1;
      const aId = a?.id || '';
      const bId = b?.id || '';
      return aId.localeCompare(bId);
    }
    function getEventDateInfo(eventDate) {
      if (eventDate === undefined || eventDate === null) return null;
      if (typeof eventDate === 'string') {
        const trimmed = eventDate.trim();
        if (!trimmed) return null;
        const parsed = parseDateValue(trimmed);
        if (parsed !== null) {
          const iso = new Date(parsed).toISOString();
          return { datetime: iso, display: formatDate(iso) };
        }
        return { datetime: trimmed, display: trimmed };
      }
      const parsed = parseDateValue(eventDate);
      if (parsed !== null) {
        const iso = new Date(parsed).toISOString();
        return { datetime: iso, display: formatDate(iso) };
      }
      const fallback = String(eventDate || '').trim();
      if (!fallback) return null;
      return { datetime: fallback, display: fallback };
    }
  
    /* ====== News & Events Sorting ====== */
    function sortNewsList() {
      const list = document.getElementById('news-list');
      if (!list) return;
      const items = Array.from(list.children);
      items.sort((a, b) => {
        const aInfo = getNodeTimeInfo(a);
        const bInfo = getNodeTimeInfo(b);
        if (aInfo.hasTime && bInfo.hasTime && bInfo.time !== aInfo.time) return bInfo.time - aInfo.time;
        if (aInfo.hasTime !== bInfo.hasTime) return aInfo.hasTime ? 1 : -1;
      return 0;
      });
      items.forEach(item => list.appendChild(item));
    }
    function getNodeTimeInfo(node) {
      const timeEl = node.querySelector('time');
      const datetime = timeEl?.getAttribute('datetime') || '';
      const time = parseDateValue(datetime);
      return { hasTime: time !== null, time };
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
        alert('Thank you! We’ll let you know when it’s posted.');
      } catch (err) {
        alert('Failed to submit. Please try again.');
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
        alert('Thank you! We’ll let you know when it’s posted.');
      } catch (err) {
        alert('Submission failed. Please try again.');
        console.error(err);
      } finally {
        if (progressWrap) progressWrap.remove();
      }
    });
  }

  /* ====== Admin Approvals (approve.html) ====== */
  const approvalsContainer = $('#admin-approvals');
  if (approvalsContainer) {
    const loginBtn = $('#admin-login');
    const logoutBtn = $('#admin-logout');
    const statusEl = $('#admin-status');
    const listEl = $('#admin-list');
    const emptyEl = $('#admin-empty');
    const emailShowBtn = $('#admin-email-show');
    const resetSignedInBtn = $('#admin-reset');
    const emailForm = $('#admin-email-form');
    const emailInput = $('#admin-email');
    const passwordInput = $('#admin-password');
    const emailLoginBtn = $('#admin-email-login');
    const emailSignupBtn = $('#admin-email-signup');
    const emailResetBtn = $('#admin-email-reset');

    loginBtn?.addEventListener('click', async () => {
      try {
        await signInWithPopup(auth, new GoogleAuthProvider());
      } catch (e) { console.error(e); }
    });
    logoutBtn?.addEventListener('click', () => signOut(auth));

    emailShowBtn?.addEventListener('click', () => {
      if (emailForm) emailForm.style.display = 'flex';
      if (loginBtn) loginBtn.style.display = 'none';
      if (emailShowBtn) emailShowBtn.style.display = 'none';
      emailInput?.focus();
    });

    async function getEmailAndPassword(){
      const email = (emailInput?.value || '').trim();
      const password = passwordInput?.value || '';
      if (!email || !password) {
        alert('Enter email and password');
        throw new Error('missing-creds');
      }
      return { email, password };
    }

    emailLoginBtn?.addEventListener('click', async () => {
      try {
        const { email, password } = await getEmailAndPassword();
        await signInWithEmailAndPassword(auth, email, password);
      } catch (e) {
        if (e?.code === 'auth/invalid-credential') alert('Invalid email or password.');
        else if (e?.message !== 'missing-creds') alert('Sign-in failed.');
        console.error(e);
      }
    });

    emailSignupBtn?.addEventListener('click', async () => {
      try {
        const { email, password } = await getEmailAndPassword();
        await createUserWithEmailAndPassword(auth, email, password);
        alert('Account created. You will only see admin items if your email is on the admin list.');
      } catch (e) {
        if (e?.code === 'auth/email-already-in-use') alert('Email already in use. Try Sign in.');
        else if (e?.code === 'auth/operation-not-allowed') alert('Email/password sign-in is not enabled for this project.');
        else if (e?.message !== 'missing-creds') alert('Sign-up failed.');
        console.error(e);
      }
    });

    emailResetBtn?.addEventListener('click', async () => {
      try {
        const email = (emailInput?.value || '').trim();
        if (!email) { alert('Enter your email to reset.'); return; }
        await sendPasswordResetEmail(auth, email);
        alert('Password reset email sent if the account exists.');
      } catch (e) {
        alert('Failed to send reset email.');
        console.error(e);
      }
    });

    resetSignedInBtn?.addEventListener('click', async () => {
      try {
        const email = auth.currentUser?.email || '';
        if (!email) { alert('No email on account.'); return; }
        await sendPasswordResetEmail(auth, email);
        alert('Password reset email sent.');
      } catch (e) {
        alert('Failed to send reset email.');
        console.error(e);
      }
    });

    function updateAuthUi(user){
      const signedIn = !!(user && !user.isAnonymous);
      if (signedIn) {
        if (statusEl) statusEl.textContent = user.email || 'Signed in';
        if (logoutBtn) { logoutBtn.style.display = ''; logoutBtn.removeAttribute('disabled'); }
        if (loginBtn) loginBtn.style.display = 'none';
        if (emailShowBtn) emailShowBtn.style.display = 'none';
        if (emailForm) emailForm.style.display = 'none';
        if (resetSignedInBtn) resetSignedInBtn.style.display = user.email ? '' : 'none';
      } else {
        if (statusEl) statusEl.textContent = 'Not signed in';
        if (logoutBtn) { logoutBtn.style.display = 'none'; logoutBtn.setAttribute('disabled','true'); }
        if (loginBtn) loginBtn.style.display = '';
        if (emailShowBtn) emailShowBtn.style.display = '';
        if (emailForm) emailForm.style.display = 'none';
        if (resetSignedInBtn) resetSignedInBtn.style.display = 'none';
      }
    }

    onAuthStateChanged(auth, async user => {
      updateAuthUi(user);
      if (!user || user.isAnonymous) {
        statusEl.textContent = 'Not signed in';
        if (loginBtn) { loginBtn.style.display = ''; loginBtn.removeAttribute('disabled'); }
        if (logoutBtn) { logoutBtn.style.display = 'none'; logoutBtn.setAttribute('disabled','true'); }
        listEl.innerHTML = '';
        if (emptyEl) {
          emptyEl.textContent = '';
          emptyEl.style.display = 'none';
        }
        return;
      }
      statusEl.textContent = user.email || 'Signed in';
      if (loginBtn) { loginBtn.style.display = 'none'; }
      if (logoutBtn) { logoutBtn.style.display = ''; logoutBtn.removeAttribute('disabled'); }

      if (!isAdminUser(user)) {
        listEl.innerHTML = '';
        if (emptyEl) {
          emptyEl.textContent = 'You are signed in, but not as an admin. Pending submissions are only visible to admins.';
          emptyEl.style.display = 'block';
        }
        return;
      }

      // Load unverified submissions
      const q = query(
        collection(db, 'submissions'),
        where('verified','==', false),
        orderBy('postedAt','desc'),
        limit(100)
      );
      const snap = await getDocs(q);
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (!items.length) {
        listEl.innerHTML = '';
        if (emptyEl) { emptyEl.textContent = 'No pending submissions.'; emptyEl.style.display = 'block'; }
      } else {
        if (emptyEl) emptyEl.style.display = 'none';
      }
      listEl.innerHTML = items.map(it => {
        const postedISO = it.postedAt?.toDate ? it.postedAt.toDate().toISOString() : '';
        const media = it.mediaURL ? (it.mediaType?.startsWith('image/')
          ? `<img alt="" src="${it.mediaURL}" style="max-width:640px;max-height:480px;object-fit:contain"/>`
          : it.mediaType?.startsWith('video/')
            ? `<video controls src="${it.mediaURL}" style="max-width:640px"></video>`
            : it.mediaType?.startsWith('audio/')
              ? `<audio controls src="${it.mediaURL}"></audio>`
              : '') : '';
        const safeContent = escapeHtml(it.content || '');
        const sectionOptions = `
          <option value="memories" ${it.section==='memories'?'selected':''}>19 Years</option>
          <option value="actions" ${it.section==='actions'?'selected':''}>Action for Change</option>
          <option value="silver" ${it.section==='silver'?'selected':''}>Silver Threads</option>
          <option value="news" ${it.section==='news'?'selected':''}>News &amp; Events</option>`;
        return `
          <li class="panel" data-id="${it.id}">
            <details>
              <summary>
                <div class="small muted" data-field="meta">${it.section} • ${postedISO ? formatDate(postedISO) : ''}</div>
                <h3 class="h3" style="margin:0.25rem 0" data-field="title">${escapeHtml((it.title && String(it.title).trim()) ? String(it.title).trim() : sanitizeTitle(it.content))}</h3>
                <div class="small muted" data-field="byline">${escapeHtml(it.author || 'Anonymous')}${it.credits ? ' • ' + escapeHtml(it.credits) : ''}${it.eventDate ? ' • ' + escapeHtml(it.eventDate) : ''}</div>
              </summary>
              <div style="margin-top:0.5rem" data-field="media">${media}</div>
              <div class="small" style="margin-top:0.5rem;white-space:pre-wrap" data-field="content">${safeContent}</div>

              <form class="admin-edit" hidden>
                <div class="form-grid">
                  <label class="field field-wide"><span>Title</span><input name="title" value="${escapeHtml(it.title || '')}"></label>
                  <label class="field field-wide"><span>Content</span><textarea name="content" rows="6">${safeContent}</textarea></label>
                  <label class="field"><span>Author</span><input name="author" value="${escapeHtml(it.author || '')}"></label>
                  <label class="field"><span>Credits</span><input name="credits" value="${escapeHtml(it.credits || '')}"></label>
                  <label class="field"><span>Date</span><input type="date" name="eventDate" value="${it.eventDate || ''}"></label>
                  <label class="field"><span>Section</span><select name="section">${sectionOptions}</select></label>
                </div>
                <div class="form-actions" style="margin-top:0.75rem;gap:0.5rem">
                  <button class="btn" data-save>Save</button>
                  <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
                </div>
              </form>

              <div class="form-actions" style="margin-top:0.75rem;gap:0.5rem;display:flex;flex-wrap:wrap">
                <button class="btn" data-approve>Approve</button>
                <button class="btn" data-edit>Edit</button>
                <button class="btn btn-ghost" data-delete>Delete</button>
              </div>
            </details>
          </li>`;
      }).join('');
      ensureCompatibleImages(listEl);

      function bindAdminActions(container){
        container.querySelectorAll('[data-approve]').forEach(btn => {
          btn.addEventListener('click', async e => {
            const li = e.currentTarget.closest('li[data-id]');
            const id = li?.getAttribute('data-id');
            if (!id) return;
            try {
              await approveSubmission(id);
              li?.remove();
              if (!listEl.children.length && emptyEl) emptyEl.style.display = 'block';
            } catch (err) {
              alert('Approve failed. Check your permissions.');
              console.error(err);
            }
          });
        });
        container.querySelectorAll('[data-edit]').forEach(btn => {
          btn.addEventListener('click', e => {
            const li = e.currentTarget.closest('li[data-id]');
            const form = li?.querySelector('.admin-edit');
            if (form) {
              form.hidden = false;
              li.querySelector('details')?.setAttribute('open','');
            }
          });
        });
        container.querySelectorAll('[data-cancel]').forEach(btn => {
          btn.addEventListener('click', e => {
            const li = e.currentTarget.closest('li[data-id]');
            const form = li?.querySelector('.admin-edit');
            if (form) form.hidden = true;
          });
        });
        container.querySelectorAll('[data-save]').forEach(btn => {
          btn.addEventListener('click', async e => {
            e.preventDefault();
            const li = e.currentTarget.closest('li[data-id]');
            const id = li?.getAttribute('data-id');
            const form = li?.querySelector('.admin-edit');
            if (!id || !form) return;
            const fd = new FormData(form);
            const updates = {
              title: String(fd.get('title') || '').trim(),
              content: String(fd.get('content') || '').trim(),
              author: String(fd.get('author') || '').trim(),
              credits: String(fd.get('credits') || '').trim(),
              eventDate: String(fd.get('eventDate') || ''),
              section: String(fd.get('section') || 'memories')
            };
            try {
              await updateDoc(doc(db, 'submissions', id), updates);
              // reflect changes in summary
              const titleEl = li.querySelector('[data-field="title"]');
              const bylineEl = li.querySelector('[data-field="byline"]');
              const contentEl = li.querySelector('[data-field="content"]');
              const metaEl = li.querySelector('[data-field="meta"]');
              if (titleEl) titleEl.textContent = updates.title || sanitizeTitle(updates.content);
              if (contentEl) contentEl.textContent = updates.content;
              if (bylineEl) {
                const parts = [];
                parts.push(updates.author || 'Anonymous');
                if (updates.credits) parts.push(updates.credits);
                if (updates.eventDate) parts.push(updates.eventDate);
                bylineEl.textContent = parts.join(' • ');
              }
              if (metaEl) metaEl.textContent = `${updates.section} • ${metaEl.textContent.split('•')[1] || ''}`;
              form.hidden = true;
            } catch (err) {
              alert('Save failed. Check your permissions.');
              console.error(err);
            }
          });
        });
        container.querySelectorAll('[data-delete]').forEach(btn => {
          btn.addEventListener('click', async e => {
            const li = e.currentTarget.closest('li[data-id]');
            const id = li?.getAttribute('data-id');
            if (!id) return;
            if (!confirm('Delete this submission?')) return;
            try {
              await deleteDoc(doc(db, 'submissions', id));
              li?.remove();
            } catch (err) {
              alert('Delete failed. Ensure rules allow admin deletes.');
              console.error(err);
            }
          });
        });
      }
      bindAdminActions(listEl);

      // Render approved items (for deletion if needed)
      const vq = query(
        collection(db, 'submissions'),
        where('verified','==', true),
        orderBy('postedAt','desc'),
        limit(100)
      );
      const vsnap = await getDocs(vq);
      const vitems = vsnap.docs.map(d => ({ id: d.id, ...d.data() }));
      let vHeader = document.getElementById('admin-approved-header');
      let vList = document.getElementById('admin-list-verified');
      if (!vHeader) {
        vHeader = document.createElement('h2');
        vHeader.id = 'admin-approved-header';
        vHeader.className = 'h2';
        vHeader.textContent = 'Approved';
        approvalsContainer.appendChild(vHeader);
      }
      if (!vList) {
        vList = document.createElement('ul');
        vList.id = 'admin-list-verified';
        vList.className = 'stack';
        vList.style.gap = '1rem';
        approvalsContainer.appendChild(vList);
      }
      vList.innerHTML = vitems.map(it => {
        const postedISO = it.postedAt?.toDate ? it.postedAt.toDate().toISOString() : '';
        const media = it.mediaURL ? (it.mediaType?.startsWith('image/')
          ? `<img alt="" src="${it.mediaURL}" style="max-width:640px;max-height:480px;object-fit:contain"/>`
          : it.mediaType?.startsWith('video/')
            ? `<video controls src="${it.mediaURL}" style="max-width:640px"></video>`
            : it.mediaType?.startsWith('audio/')
              ? `<audio controls src="${it.mediaURL}"></audio>`
              : '') : '';
        const safeContent = escapeHtml(it.content || '');
        const safeTitle = escapeHtml((it.title && String(it.title).trim()) ? String(it.title).trim() : sanitizeTitle(it.content));
        const sectionOptions = `
          <option value="memories" ${it.section==='memories'?'selected':''}>19 Years</option>
          <option value="actions" ${it.section==='actions'?'selected':''}>Action for Change</option>
          <option value="silver" ${it.section==='silver'?'selected':''}>Silver Threads</option>
          <option value="news" ${it.section==='news'?'selected':''}>News &amp; Events</option>`;
        return `
          <li class="panel" data-id="${it.id}">
            <details>
              <summary>
                <div class="small muted" data-field="meta">${it.section} • ${postedISO ? formatDate(postedISO) : ''}</div>
                <h3 class="h3" style="margin:0.25rem 0" data-field="title">${safeTitle}</h3>
                <div class="small muted" data-field="byline">${escapeHtml(it.author || 'Anonymous')}${it.credits ? ' • ' + escapeHtml(it.credits) : ''}${it.eventDate ? ' • ' + escapeHtml(it.eventDate) : ''}</div>
              </summary>
              <div style="margin-top:0.5rem" data-field="media">${media}</div>
              <div class="small" style="margin-top:0.5rem;white-space:pre-wrap" data-field="content">${safeContent}</div>

              <form class="admin-edit" hidden>
                <div class="form-grid">
                  <label class="field field-wide"><span>Title</span><input name="title" value="${escapeHtml(it.title || '')}"></label>
                  <label class="field field-wide"><span>Content</span><textarea name="content" rows="6">${safeContent}</textarea></label>
                  <label class="field"><span>Author</span><input name="author" value="${escapeHtml(it.author || '')}"></label>
                  <label class="field"><span>Credits</span><input name="credits" value="${escapeHtml(it.credits || '')}"></label>
                  <label class="field"><span>Date</span><input type="date" name="eventDate" value="${it.eventDate || ''}"></label>
                  <label class="field"><span>Section</span><select name="section">${sectionOptions}</select></label>
                </div>
                <div class="form-actions" style="margin-top:0.75rem;gap:0.5rem">
                  <button class="btn" data-save>Save</button>
                  <button type="button" class="btn btn-ghost" data-cancel>Cancel</button>
                </div>
              </form>

              <div class="form-actions" style="margin-top:0.75rem">
                <button class="btn" data-edit>Edit</button>
                <button class="btn btn-ghost" data-delete>Delete</button>
              </div>
            </details>
          </li>`;
      }).join('');
      ensureCompatibleImages(vList);
      bindAdminActions(vList);
      });
    }
  
    function resetErrors(form) { $$('.error', form).forEach(el => el.textContent = ''); }
  function setError(form, name, msg) {
    const el = form.querySelector(`[data-error-for="${name}"]`);
      if (el) el.textContent = msg;
    }

  /* ====== Static hero image ====== */
  (function setHeroImage(){
      const img = document.getElementById('hero-image');
        if (!img) return;
    if (!img.getAttribute('src')) img.remove();
    })();
  })();
  
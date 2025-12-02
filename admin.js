/* Admin approvals functionality */

import {
  auth,
  db,
  ADMIN_EMAILS,
  isAdminUser,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  collection,
  getDocs,
  doc,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc
} from './firebase.js';

import {
  escapeHtml,
  formatDate,
  sanitizeTitle,
  buildSectionOptions
} from './utils.js';

import { ensureCompatibleImages } from './heic.js';
import { approveSubmission } from './submissions.js';

export function initAdminPage({ $ }) {
  const approvalsContainer = $('#admin-approvals');
  if (!approvalsContainer) return;

  const loginBtn = $('#admin-login');
  const logoutBtn = $('#admin-logout');
  const statusEl = $('#admin-status');
  const listEl = $('#admin-list');
  const emptyEl = $('#admin-empty');
  let pendingHeader = $('#admin-pending-header');
  const helpText = $('#admin-help-text');
  
  if (!pendingHeader) {
    pendingHeader = document.createElement('h2');
    pendingHeader.id = 'admin-pending-header';
    pendingHeader.className = 'h2 admin-submissions-heading';
    pendingHeader.textContent = 'Submissions';
    pendingHeader.style.display = 'none';
    approvalsContainer.insertBefore(pendingHeader, approvalsContainer.firstChild);
  }
  
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

  async function getEmailAndPassword() {
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

  function updateAuthUi(user) {
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

  function bindAdminActions(container) {
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

  function renderSubmissionItem(it, showApprove = true) {
    const postedISO = it.postedAt?.toDate ? it.postedAt.toDate().toISOString() : '';
    const media = it.mediaURL ? (it.mediaType?.startsWith('image/')
      ? `<img alt="" src="${it.mediaURL}" style="max-width:640px;max-height:480px;object-fit:contain" loading="lazy" />`
      : it.mediaType?.startsWith('video/')
        ? `<video controls src="${it.mediaURL}" style="max-width:640px" preload="metadata"></video>`
        : it.mediaType?.startsWith('audio/')
          ? `<audio controls src="${it.mediaURL}" preload="metadata"></audio>`
          : '') : '';
    const safeContent = escapeHtml(it.content || '');
    const safeEmail = escapeHtml(it.email || '');
    const safeTitle = escapeHtml((it.title && String(it.title).trim()) ? String(it.title).trim() : sanitizeTitle(it.content));
    const sectionOptions = buildSectionOptions(it.section);
    
    return `
      <li class="panel" data-id="${it.id}">
        <details>
          <summary>
            <div class="small muted" data-field="meta">${it.section} • ${postedISO ? formatDate(postedISO) : ''}</div>
            <h3 class="h3" style="margin:0.25rem 0" data-field="title">${safeTitle}</h3>
            <div class="small muted" data-field="byline">${escapeHtml(it.author || 'Anonymous')}${it.credits ? ' • ' + escapeHtml(it.credits) : ''}${it.eventDate ? ' • ' + escapeHtml(it.eventDate) : ''}</div>
            ${safeEmail ? `<div class="small muted" data-field="email">Email: ${safeEmail}</div>` : ''}
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
            ${showApprove ? '<button class="btn" data-approve>Approve</button>' : ''}
            <button class="btn" data-edit>Edit</button>
            <button class="btn btn-ghost" data-delete>Delete</button>
          </div>
        </details>
      </li>`;
  }

  onAuthStateChanged(auth, async user => {
    updateAuthUi(user);
    if (!user || user.isAnonymous) {
      statusEl.textContent = 'Not signed in';
      if (loginBtn) { loginBtn.style.display = ''; loginBtn.removeAttribute('disabled'); }
      if (logoutBtn) { logoutBtn.style.display = 'none'; logoutBtn.setAttribute('disabled','true'); }
      listEl.innerHTML = '';
      if (pendingHeader) pendingHeader.style.display = 'none';
      if (helpText) helpText.style.display = '';
      if (emptyEl) {
        emptyEl.textContent = '';
        emptyEl.style.display = 'none';
      }
      return;
    }
    statusEl.textContent = user.email || 'Signed in';
    if (helpText) helpText.style.display = 'none';
    if (loginBtn) { loginBtn.style.display = 'none'; }
    if (logoutBtn) { logoutBtn.style.display = ''; logoutBtn.removeAttribute('disabled'); }

    if (pendingHeader) pendingHeader.style.display = '';
    if (!isAdminUser(user)) {
      if (pendingHeader) pendingHeader.style.display = 'none';
      if (helpText) helpText.style.display = 'none';
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
    listEl.innerHTML = items.map(it => renderSubmissionItem(it, true)).join('');
    ensureCompatibleImages(listEl);
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
    vList.innerHTML = vitems.map(it => renderSubmissionItem(it, false)).join('');
    ensureCompatibleImages(vList);
    bindAdminActions(vList);
  });
}


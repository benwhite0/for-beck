/* Image compression and upload to Firebase Storage */

import { auth, storage, storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from './firebase.js';
import { HEIC_EXT_RE, convertHeicFile } from './heic.js';

export async function compressImageIfNeeded(file) {
  try {
    if (!file) return file;
    const name = file.name || '';
    const type = file.type || '';
    const hasImageMime = type.startsWith('image/');
    const hasHeicExt = HEIC_EXT_RE.test(name);
    const looksHeicMime = /image\/(heic|heif)/i.test(type);
    const treatAsImage = hasImageMime || hasHeicExt;
    console.info('[image] inspect file', { name, type, size: file.size, hasImageMime, hasHeicExt, looksHeicMime });
    if (!treatAsImage) return file;

    let working = file;
    if (looksHeicMime || hasHeicExt) {
      const converted = await convertHeicFile(file);
      working = converted;
      if (/image\/(heic|heif)/i.test(working.type || '') || HEIC_EXT_RE.test(working.name || '')) {
        return working;
      }
    }

    if (!(working.type || '').startsWith('image/')) {
      console.warn('[image] skipping compression, no image mime after conversion', { name: working.name, type: working.type });
      return working;
    }

    // Read into image
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(working);
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
    if (!ctx) return working;
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const quality = 0.82;
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) return working;
    // If compression didn't help, keep original
    if (blob.size >= working.size) return working;
    return new File([blob], (working.name || 'image')
      .replace(/\.(heic|heif|png|webp|jpg|jpeg)$/i, '') + '.jpg', { type: 'image/jpeg' });
  } catch (err) {
    console.error('[image] compression failed, returning original', err);
    return file;
  }
}

export async function uploadMedia(file, section, onProgress) {
  if (!file) return { mediaURL: '', mediaType: '' };
  // Prepare file: compress images; enforce size/type limits
  let prepared = file;
  const originalMeta = file ? { name: file.name, type: file.type, size: file.size } : null;
  prepared = await compressImageIfNeeded(file);
  if (originalMeta) {
    if (prepared !== file) {
      console.info('[upload] image prepared', {
        original: originalMeta,
        prepared: { name: prepared.name, type: prepared.type, size: prepared.size }
      });
    } else {
      console.info('[upload] image unchanged', originalMeta);
    }
  }
  const MAX_BYTES = 50 * 1024 * 1024; // 50MB safeguard (mirrors rules)
  if (prepared.size > MAX_BYTES) {
    throw new Error('File too large. Please choose a file under 50 MB.');
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
    console.info('[upload] completed with resumable task', { bytes: prepared.size, path });
  } else {
    await uploadBytes(ref, prepared, { contentType: prepared.type });
    console.info('[upload] completed without progress listener', { bytes: prepared.size, path });
  }
  const url = await getDownloadURL(ref);
  return { mediaURL: url, mediaType: prepared.type };
}


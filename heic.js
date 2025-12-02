/* HEIC/HEIF image conversion for iOS compatibility */

export const HEIC_EXT_RE = /\.(heic|heif)(?:$|[?#])/i;

let heicLoaderPromise;

const renameWithExt = (name = 'image', ext) => {
  const base = String(name || '').replace(/\.[^/.]+$/, '');
  return `${base || 'image'}${ext}`;
};

export async function loadHeic2Any() {
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

export async function convertHeicFile(file) {
  const looksHeic = /image\/(heic|heif)/i.test(file?.type || '') || HEIC_EXT_RE.test(file?.name || '');
  if (!looksHeic || !file) return file;
  console.info('[heic] attempting conversion', { name: file.name, type: file.type, size: file.size });
  try {
    await loadHeic2Any();
    try {
      const webpBlob = await window.heic2any({ blob: file, toType: 'image/webp', quality: 0.86 });
      const converted = new File([webpBlob], renameWithExt(file.name, '.webp'), { type: 'image/webp' });
      console.info('[heic] converted to webp', { type: converted.type, size: converted.size });
      return converted;
    } catch (errWebp) {
      console.warn('[heic] webp conversion failed, retrying jpeg', errWebp);
      const jpgBlob = await window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.88 });
      const converted = new File([jpgBlob], renameWithExt(file.name, '.jpg'), { type: 'image/jpeg' });
      console.info('[heic] converted to jpeg', { type: converted.type, size: converted.size });
      return converted;
    }
  } catch (err) {
    console.error('[heic] conversion failed, returning original', err);
    return file;
  }
}

export function ensureCompatibleImages(root = document) {
  root.querySelectorAll('img').forEach(img => {
    const src = img.getAttribute('src') || '';
    if (HEIC_EXT_RE.test(src)) convertImageElement(img);
    else img.addEventListener('error', () => convertImageElement(img), { once: true });
  });
}

export async function convertImageElement(img) {
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


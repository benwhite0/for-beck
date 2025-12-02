/* Pure utility functions - no external dependencies */

export const SECTION_ORDER = ['memories', 'actions', 'news', 'silver'];

export const SECTION_DISPLAY = {
  memories: '2003-2022',
  actions: '2022 and beyond — In pictures',
  news: '2022 and beyond — Diary of events',
  silver: 'Silver Threads'
};

export function debounce(fn, wait = 120) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function escapeHtml(str) {
  return String(str || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export function sanitizeTitle(text) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (t.length <= 80) return t;
  return t.slice(0, 77) + '…';
}

export function makeSnippet(text, maxLength = 140) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  const slice = normalized.slice(0, Math.max(0, maxLength - 3));
  const boundary = slice.lastIndexOf(' ');
  const trimmed = boundary > 40 ? slice.slice(0, boundary) : slice;
  return trimmed.replace(/\s+$/, '') + '...';
}

export function parseDateValue(value) {
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

export function compareSubmissionsByEventDateAsc(a, b) {
  return compareSubmissionsByEventDate(b, a);
}

export function compareSubmissionsByEventDate(a, b) {
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

export function getEventDateInfo(eventDate) {
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

export function shuffleArray(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function formatNewsContent(text) {
  return escapeHtml(text || '').replace(/\n{2,}/g, '\n\n').split('\n\n').map(
    block => `<p>${block.replace(/\n/g, '<br />')}</p>`
  ).join('').replace(/(<p><\/p>)+/g, '');
}

export function sectionKeyToFeedId(key) {
  switch (key) {
    case 'memories': return 'feed-memories';
    case 'actions': return 'feed-actions';
    case 'silver': return 'feed-silver';
    case 'news': return 'news-list';
    default: return 'feed-memories';
  }
}

export function sectionPage(key) {
  switch (key) {
    case 'memories': return '../nineteen-years/';
    case 'actions': return '../news-events/#view=gallery';
    case 'silver': return '../support/';
    case 'news': return '../news-events/#view=list';
    default: return '../home/';
  }
}

export function sectionTitle(key) {
  return SECTION_DISPLAY[key] || 'Home';
}

export function buildSectionOptions(selectedSection) {
  return SECTION_ORDER.map(section => {
    const label = SECTION_DISPLAY[section] || section;
    const isSelected = section === selectedSection ? ' selected' : '';
    return `<option value="${section}"${isSelected}>${label}</option>`;
  }).join('');
}


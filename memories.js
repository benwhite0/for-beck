/* Memories state management, masonry layout, and sorting */

import {
  debounce,
  escapeHtml,
  sanitizeTitle,
  makeSnippet,
  getEventDateInfo,
  shuffleArray,
  compareSubmissionsByEventDate,
  compareSubmissionsByEventDateAsc
} from './utils.js';

import { ensureCompatibleImages } from './heic.js';

const masonryResizeHandlers = new WeakMap();

function applyMasonryLayout(grid) {
  if (!grid || !grid.classList.contains('card-grid-memories')) return;
  const style = getComputedStyle(grid);
  const rowHeight = parseFloat(style.gridAutoRows) || 12;
  const gap = parseFloat(style.rowGap) || 0;
  const cards = Array.from(grid.children);
  cards.forEach(card => {
    const inner = card.firstElementChild;
    const contentHeight = (inner ? inner.scrollHeight : 0) || card.scrollHeight || card.getBoundingClientRect().height;
    const totalHeight = contentHeight + gap;
    const span = Math.max(1, Math.ceil(totalHeight / (rowHeight + gap)));
    card.style.gridRowEnd = `span ${span}`;
  });
}

export function setupMemoriesMasonry(grid) {
  if (!grid) return;
  const refresh = () => applyMasonryLayout(grid);
  requestAnimationFrame(refresh);
  grid.querySelectorAll('img, video, audio').forEach(media => {
    if (media.dataset.masonryBound === '1') return;
    const onLoad = () => refresh();
    media.addEventListener('load', onLoad, { once: true });
    media.addEventListener('loadeddata', onLoad, { once: true });
    media.dataset.masonryBound = '1';
    if (('complete' in media && media.complete) || media.readyState >= 2) {
      onLoad();
    }
  });
  if (!masonryResizeHandlers.has(grid)) {
    const resizeHandler = debounce(refresh, 180);
    masonryResizeHandlers.set(grid, resizeHandler);
    window.addEventListener('resize', resizeHandler);
  }
}

export const memoriesState = {
  order: 'random',
  lastApplied: '',
  list: [],
  filteredList: [],
  feedEl: null,
  buttons: [],
  emptyEl: null,
  emptyDefault: ''
};

export function createMemoriesModule({ searchModule, $$ }) {
  
  function renderFeedListToElement(feedEl, list, section) {
    if (!feedEl) return;
    const itemsHtml = (list || []).map(item => {
      const eventInfo = getEventDateInfo(item.eventDate);
      const metaHtml = eventInfo
        ? `<time datetime="${escapeHtml(eventInfo.datetime)}">${escapeHtml(eventInfo.display)}</time>`
        : '';
      const hasMedia = !!item.mediaURL;
      let mediaHtml = '';
      if (hasMedia) {
        if (item.mediaType?.startsWith('image/')) {
          mediaHtml = `<div class="card-media"><img alt="" src="${item.mediaURL}" loading="lazy" /></div>`;
        } else if (item.mediaType?.startsWith('video/')) {
          mediaHtml = `<div class="card-media"><video controls src="${item.mediaURL}" preload="metadata"></video></div>`;
        } else if (item.mediaType?.startsWith('audio/')) {
          mediaHtml = `<div class="card-media"><audio controls src="${item.mediaURL}" preload="metadata"></audio></div>`;
        }
      }
      const displayTitle = (item.title && String(item.title).trim()) ? String(item.title).trim() : sanitizeTitle(item.content);
      const snippetText = !hasMedia ? makeSnippet(item.content, 170) : '';
      const u = new URL('../entry/', document.baseURI);
      u.searchParams.set('id', item.id);
      u.searchParams.set('section', section);
      const link = `${u.pathname}${u.search}#id=${encodeURIComponent(item.id)}&section=${encodeURIComponent(section)}`;
      return `
          <li class="card" role="article">
            <a href="${link}" class="card-link-wrap">
              ${mediaHtml}
              <div class="card-body">
                ${metaHtml ? `<div class="card-meta">${metaHtml}</div>` : ''}
                <h3 class="card-title">${escapeHtml(displayTitle)}</h3>
                ${snippetText ? `<p class="card-snippet">${escapeHtml(snippetText)}</p>` : ''}
              </div>
            </a>
          </li>`;
    }).join('');
    feedEl.innerHTML = itemsHtml;
    feedEl.setAttribute('aria-busy', 'false');
    ensureCompatibleImages(feedEl);
    if (section === 'memories' || section === 'silver' || section === 'actions') {
      setupMemoriesMasonry(feedEl);
    }
  }

  function getMemoriesOrderedList(list, order) {
    const arr = list.slice();
    switch (order) {
      case 'asc':
        return arr.sort(compareSubmissionsByEventDateAsc);
      case 'desc':
        return arr.sort(compareSubmissionsByEventDate);
      case 'random':
      default:
        return shuffleArray(arr);
    }
  }

  function updateMemoriesSortButtonsState(activeOrder, disabled = false) {
    memoriesState.buttons.forEach(btn => {
      const order = btn.getAttribute('data-memories-sort') || '';
      const isActive = !disabled && order === activeOrder;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
      btn.disabled = disabled;
    });
  }

  function updateMemoriesEmptyState(renderedLength) {
    const emptyEl = memoriesState.emptyEl;
    if (!emptyEl) return;
    const hasItems = memoriesState.list.length > 0;
    const hasQuery = !!(searchModule && searchModule.state.query);
    if (!hasItems) {
      emptyEl.textContent = memoriesState.emptyDefault || emptyEl.textContent;
      emptyEl.style.display = 'block';
      return;
    }
    if (hasQuery && renderedLength === 0) {
      emptyEl.textContent = 'No memories match your search.';
      emptyEl.style.display = 'block';
      return;
    }
    emptyEl.textContent = memoriesState.emptyDefault || emptyEl.textContent;
    emptyEl.style.display = 'none';
  }

  function applyMemoriesSort(order, { force = false } = {}) {
    if (order) memoriesState.order = order;
    const targetOrder = memoriesState.order || 'random';
    if (!memoriesState.feedEl) {
      updateMemoriesSortButtonsState(targetOrder, memoriesState.list.length === 0);
      return;
    }
    if (!memoriesState.list.length) {
      memoriesState.feedEl.innerHTML = '';
      memoriesState.feedEl.setAttribute('aria-busy', 'false');
      updateMemoriesSortButtonsState(targetOrder, true);
      updateMemoriesEmptyState(0);
      return;
    }
    const hasQuery = !!(searchModule && searchModule.state.query);
    if (!force && targetOrder !== 'random' && memoriesState.lastApplied === targetOrder && !hasQuery) {
      updateMemoriesSortButtonsState(targetOrder, false);
      updateMemoriesEmptyState(memoriesState.filteredList.length);
      return;
    }
    const arranged = getMemoriesOrderedList(memoriesState.filteredList, targetOrder);
    renderFeedListToElement(memoriesState.feedEl, arranged, 'memories');
    memoriesState.lastApplied = targetOrder;
    updateMemoriesSortButtonsState(targetOrder, false);
    updateMemoriesEmptyState(arranged.length);
  }

  function initSortButtons() {
    const memoriesSortButtons = $$('[data-memories-sort]');
    if (memoriesSortButtons.length) {
      memoriesState.buttons = memoriesSortButtons;
      updateMemoriesSortButtonsState(memoriesState.order, true);
      memoriesSortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          const nextOrder = btn.getAttribute('data-memories-sort') || 'random';
          applyMemoriesSort(nextOrder);
        });
      });
    }
  }

  return {
    renderFeedListToElement,
    getMemoriesOrderedList,
    updateMemoriesSortButtonsState,
    updateMemoriesEmptyState,
    applyMemoriesSort,
    initSortButtons
  };
}


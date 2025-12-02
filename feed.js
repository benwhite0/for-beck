/* Feed and news list rendering */

import {
  escapeHtml,
  sanitizeTitle,
  parseDateValue,
  getEventDateInfo,
  formatNewsContent,
  compareSubmissionsByEventDate
} from './utils.js';

import { ensureCompatibleImages } from './heic.js';

import { fetchSectionPosts } from './submissions.js';

export function createFeedModule({ $, searchModule, memoriesState, memoriesModule }) {
  const { renderFeedListToElement, applyMemoriesSort, updateMemoriesSortButtonsState, updateMemoriesEmptyState } = memoriesModule;

  async function renderFeed(section, feedEl) {
    if (!feedEl) return;
    feedEl.setAttribute('aria-busy', 'true');
    const list = await fetchSectionPosts(section);
    const emptyMsg = document.querySelector(`[data-empty-for="${section}"]`);
    if (section === 'memories') {
      memoriesState.feedEl = feedEl;
      if (emptyMsg) {
        memoriesState.emptyEl = emptyMsg;
        if (!memoriesState.emptyDefault) {
          memoriesState.emptyDefault = emptyMsg.textContent || '';
        }
      }
    }
    const searchState = searchModule?.state;
    if (!list.length) {
      if (emptyMsg) emptyMsg.style.display = 'block';
      feedEl.innerHTML = '';
      feedEl.setAttribute('aria-busy', 'false');
      if (section === 'memories') {
        memoriesState.list = [];
        memoriesState.filteredList = [];
        memoriesState.lastApplied = '';
        updateMemoriesSortButtonsState(memoriesState.order, true);
        updateMemoriesEmptyState(0);
        if (searchState) searchState.memoriesList = [];
      }
      if (section === 'silver' && searchState) searchState.silverList = [];
      if (section === 'actions' && searchState) searchState.actionsList = [];
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    if (section === 'memories') {
      memoriesState.list = list.slice();
      memoriesState.lastApplied = '';
      if (searchState) searchState.memoriesList = list.slice();
      const terms = searchModule.buildMemoriesSearchTerms(searchState?.query || '');
      memoriesState.filteredList = searchModule.filterMemoriesList(list, terms);
      applyMemoriesSort(memoriesState.order, { force: true });
      return;
    }

    if (section === 'silver') {
      if (searchState) searchState.silverList = list.slice();
      const terms = searchModule.buildMemoriesSearchTerms(searchState?.query || '');
      const filtered = searchModule.filterMemoriesList(list, terms);
      const sortedList = filtered.slice().sort(compareSubmissionsByEventDate);
      renderFeedListToElement(feedEl, sortedList, section);
      return;
    }

    if (section === 'actions') {
      if (searchState) searchState.actionsList = list.slice();
      const terms = searchModule.buildMemoriesSearchTerms(searchState?.query || '');
      const filtered = searchModule.filterMemoriesList(list, terms);
      const sortedList = filtered.slice().sort(compareSubmissionsByEventDate);
      renderFeedListToElement(feedEl, sortedList, section);
      return;
    }

    const sortedList = list.slice().sort(compareSubmissionsByEventDate);
    renderFeedListToElement(feedEl, sortedList, section);
  }

  async function renderNewsList() {
    const listEl = document.getElementById('news-list');
    if (!listEl) return;
    const posts = await fetchSectionPosts('news');
    listEl.querySelectorAll('.js-news-dynamic, .news-list-divider').forEach(node => node.remove());
    if (!posts.length) return;
    const sortedPosts = posts.slice().sort(compareSubmissionsByEventDate);
    const fragment = document.createDocumentFragment();
    sortedPosts.forEach(item => {
      const li = document.createElement('li');
      li.className = 'js-news-dynamic';
      const eventTime = parseDateValue(item.eventDate);
      const eventInfo = getEventDateInfo(item.eventDate);
      const dateHtml = eventInfo
        ? `<time class="news-date" datetime="${escapeHtml(eventInfo.datetime)}">${escapeHtml(eventInfo.display)}</time>`
        : '';
      
      let mediaHtml = '';
      if (item.mediaURL) {
        if (item.mediaType?.startsWith('image/')) {
          mediaHtml = `<div class="news-media"><img alt="" src="${item.mediaURL}" loading="lazy" /></div>`;
        } else if (item.mediaType?.startsWith('video/')) {
          mediaHtml = `<div class="news-media"><video controls src="${item.mediaURL}" preload="metadata"></video></div>`;
        } else if (item.mediaType?.startsWith('audio/')) {
          mediaHtml = `<div class="news-media"><audio controls src="${item.mediaURL}" preload="metadata"></audio></div>`;
        }
      }
      
      const titleText = escapeHtml(item.title && String(item.title).trim() ? String(item.title).trim() : sanitizeTitle(item.content));
      
      li.innerHTML = `
        <details class="news-item${eventInfo ? '' : ' news-item--no-date'}">
          <summary class="news-summary">
            ${dateHtml}
            <h3 class="h3 news-title">${titleText}</h3>
          </summary>
          <div class="news-body">
            ${mediaHtml}
            ${formatNewsContent(item.content)}
          </div>
        </details>
      `;
      if (eventTime !== null) {
        li.dataset.eventTime = String(eventTime);
      } else if (li.dataset.eventTime) {
        delete li.dataset.eventTime;
      }
      fragment.appendChild(li);
    });
    listEl.appendChild(fragment);
    const searchState = searchModule?.state;
    if (searchState) {
      searchState.newsList = posts.slice();
    }
    ensureCompatibleImages(listEl);
  }

  function getNodeTimeInfo(node) {
    if (!node || node.classList?.contains('news-list-divider')) return { hasTime: false, time: null };
    const dataTime = node.dataset?.eventTime;
    if (dataTime !== undefined) {
      const parsed = Number(dataTime);
      if (Number.isFinite(parsed)) return { hasTime: true, time: parsed };
    }
    const timeEl = node.querySelector('time');
    const datetime = timeEl?.getAttribute('datetime') || '';
    const time = parseDateValue(datetime);
    return { hasTime: time !== null, time };
  }

  function buildNewsDivider() {
    const divider = document.createElement('li');
    divider.className = 'news-list-divider';
    divider.setAttribute('role', 'separator');
    divider.innerHTML = `<span aria-hidden="true"></span><span class="news-divider-label">Past events</span><span aria-hidden="true"></span>`;
    return divider;
  }

  function sortNewsList() {
    const list = document.getElementById('news-list');
    if (!list) return;
    const existingDivider = list.querySelector('.news-list-divider');
    if (existingDivider) existingDivider.remove();
    const items = Array.from(list.children).filter(item => !item.classList.contains('news-list-divider'));
    if (!items.length) return;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    items.sort((a, b) => {
      const aInfo = getNodeTimeInfo(a);
      const bInfo = getNodeTimeInfo(b);
      const aUpcoming = aInfo.hasTime && aInfo.time !== null && aInfo.time >= todayMs;
      const bUpcoming = bInfo.hasTime && bInfo.time !== null && bInfo.time >= todayMs;
      if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
      if (aInfo.hasTime && bInfo.hasTime && bInfo.time !== aInfo.time) return bInfo.time - aInfo.time;
      if (aInfo.hasTime !== bInfo.hasTime) return (bInfo.hasTime ? 1 : 0) - (aInfo.hasTime ? 1 : 0);
      return 0;
    });
    items.forEach(item => list.appendChild(item));
    let upcomingCount = 0;
    for (const item of items) {
      const info = getNodeTimeInfo(item);
      const isUpcoming = info.hasTime && info.time !== null && info.time >= todayMs;
      if (isUpcoming) {
        upcomingCount += 1;
      } else {
        break;
      }
    }
    if (upcomingCount > 0 && upcomingCount < items.length) {
      const divider = existingDivider || buildNewsDivider();
      list.insertBefore(divider, items[upcomingCount] || null);
    }
  }

  return {
    renderFeed,
    renderNewsList,
    sortNewsList
  };
}


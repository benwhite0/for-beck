export function createSearchModule({
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
}) {
  if (typeof $ !== 'function') {
    throw new Error('Search module requires a DOM query helper.');
  }
  if (!memoriesState) {
    throw new Error('Search module requires memoriesState.');
  }

  const globalSearchState = {
    query: '',
    allPosts: [],
    memoriesList: [],
    silverList: [],
    actionsList: [],
    newsList: []
  };

  function getMemoriesSearchText(item) {
    if (!item || typeof item !== 'object') return '';
    if (item._memSearchText) return item._memSearchText;
    const parts = [];
    const title = item.title && String(item.title).trim();
    if (title) parts.push(title);
    const content = item.content && String(item.content);
    if (content) parts.push(content);
    const author = item.author && String(item.author);
    if (author) parts.push(author);
    const credits = item.credits && String(item.credits);
    if (credits) parts.push(credits);
    const eventDate = item.eventDate;
    if (eventDate) parts.push(String(eventDate));
    if (typeof getEventDateInfo === 'function') {
      const eventInfo = getEventDateInfo(eventDate);
      if (eventInfo) {
        if (eventInfo.display) parts.push(eventInfo.display);
        if (eventInfo.datetime) parts.push(eventInfo.datetime);
      }
    }
    if (typeof parseDateValue === 'function') {
      const postedTime = parseDateValue(item.postedAt);
      if (postedTime !== null) {
        parts.push(new Date(postedTime).toISOString());
      }
    }
    const text = parts.join(' ').toLowerCase();
    Object.defineProperty(item, '_memSearchText', {
      value: text,
      configurable: true,
      enumerable: false,
      writable: false
    });
    return text;
  }

  function filterMemoriesList(list, terms) {
    if (!Array.isArray(list)) return [];
    if (!terms?.length) return list.slice();
    return list.filter(item => {
      const haystack = getMemoriesSearchText(item);
      if (!haystack) return false;
      return terms.every(term => haystack.includes(term));
    });
  }

  function buildMemoriesSearchTerms(normalized) {
    if (!normalized) return [];
    const tokens = normalized.split(/[\s,./\\_-]+/).filter(Boolean);
    return tokens.length ? tokens : [];
  }

  function applyGlobalSearch(rawQuery) {
    const normalized = (typeof rawQuery === 'string' ? rawQuery : '').trim().toLowerCase();
    globalSearchState.query = normalized;
    const terms = buildMemoriesSearchTerms(normalized);
    memoriesState.filteredList = filterMemoriesList(memoriesState.list, terms);
    applyMemoriesSort(memoriesState.order, { force: true });
    const silverFeedEl = $('#feed-silver');
    if (silverFeedEl) {
      const filtered = filterMemoriesList(globalSearchState.silverList, terms);
      renderFeedListToElement(
        silverFeedEl,
        filtered.slice().sort(compareSubmissionsByEventDate),
        'silver'
      );
    }
    const actionsFeedEl = $('#feed-actions');
    if (actionsFeedEl) {
      const filtered = filterMemoriesList(globalSearchState.actionsList, terms);
      renderFeedListToElement(
        actionsFeedEl,
        filtered.slice().sort(compareSubmissionsByEventDate),
        'actions'
      );
    }
  }

  async function performGlobalSearch(rawQuery) {
    const summaryEl = $('#search-summary');
    const emptyEl = $('#search-empty');
    if (!summaryEl) return;

    const normalized = rawQuery.trim().toLowerCase();

    if (!normalized) {
      summaryEl.textContent = 'Enter a search term above';
      if (emptyEl) emptyEl.hidden = true;
      ['memories', 'silver', 'actions', 'news'].forEach(section => {
        const sectionEl = $(`#search-section-${section}`);
        if (sectionEl) sectionEl.hidden = true;
      });
      return;
    }

    summaryEl.textContent = 'Searching...';

    const [memoriesList, silverList, actionsList, newsList] = await Promise.all([
      fetchSectionPosts('memories'),
      fetchSectionPosts('silver'),
      fetchSectionPosts('actions'),
      fetchSectionPosts('news')
    ]);

    const terms = buildMemoriesSearchTerms(normalized);

    const memoriesFiltered = filterMemoriesList(memoriesList, terms);
    const silverFiltered = filterMemoriesList(silverList, terms);
    const actionsFiltered = filterMemoriesList(actionsList, terms);
    const newsFiltered = filterMemoriesList(newsList, terms);

    const totalResults =
      memoriesFiltered.length +
      silverFiltered.length +
      actionsFiltered.length +
      newsFiltered.length;

    if (totalResults === 0) {
      summaryEl.textContent = `No results found for "${rawQuery}"`;
      if (emptyEl) emptyEl.hidden = false;
    } else {
      summaryEl.textContent = `Found ${totalResults} result${totalResults === 1 ? '' : 's'} for "${rawQuery}"`;
      if (emptyEl) emptyEl.hidden = true;
    }

    renderSearchSection('memories', memoriesFiltered);
    renderSearchSection('silver', silverFiltered);
    renderSearchSection('actions', actionsFiltered);
    renderSearchSection('news', newsFiltered);
  }

  function renderSearchSection(section, results) {
    const sectionEl = $(`#search-section-${section}`);
    const feedEl = $(`#search-feed-${section}`);
    const countEl = $(`[data-count-for="${section}"]`);

    if (!sectionEl || !feedEl) return;

    if (results.length === 0) {
      sectionEl.hidden = true;
      return;
    }

    sectionEl.hidden = false;
    if (countEl) {
      countEl.textContent = `(${results.length})`;
    }

    if (section === 'news') {
      renderNewsSearchResults(feedEl, results);
    } else {
      const sorted = results.slice().sort(compareSubmissionsByEventDate);
      renderFeedListToElement(feedEl, sorted, section);
    }
  }

  function renderNewsSearchResults(listEl, items) {
    if (!listEl) return;
    const sorted = items.slice().sort(compareSubmissionsByEventDate);
    const html = sorted
      .map(item => {
        const eventInfo = typeof getEventDateInfo === 'function' ? getEventDateInfo(item.eventDate) : null;
        const dateHtml = eventInfo
          ? `<time class="news-date" datetime="${escapeHtml(eventInfo.datetime)}">${escapeHtml(eventInfo.display)}</time>`
          : '';
        
        let mediaHtml = '';
        if (item.mediaURL) {
          if (item.mediaType?.startsWith('image/')) {
            mediaHtml = `<div class="news-media"><img alt="" src="${item.mediaURL}" /></div>`;
          } else if (item.mediaType?.startsWith('video/')) {
            mediaHtml = `<div class="news-media"><video controls src="${item.mediaURL}"></video></div>`;
          } else if (item.mediaType?.startsWith('audio/')) {
            mediaHtml = `<div class="news-media"><audio controls src="${item.mediaURL}"></audio></div>`;
          }
        }
        
        const titleText = escapeHtml(
          item.title && String(item.title).trim()
            ? String(item.title).trim()
            : sanitizeTitle(item.content)
        );
        
        return `
        <li>
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
        </li>`;
      })
      .join('');
    listEl.innerHTML = html;
  }

  function attachGlobalSearchInput(inputEl, { formEl = null, isSearchPage = false, buildSearchUrl } = {}) {
    if (!inputEl) return;

    const buildUrl =
      typeof buildSearchUrl === 'function'
        ? buildSearchUrl
        : (query) => {
            const url = new URL('../search/', document.baseURI);
            url.searchParams.set('q', query);
            return url;
          };

    const navigateToSearch = (query) => {
      if (!query) return;
      const url = buildUrl(query);
      location.href = url.pathname + url.search;
    };

    if (!isSearchPage) {
      if (formEl) {
        formEl.addEventListener('submit', e => {
          e.preventDefault();
          const query = inputEl.value.trim();
          if (query) navigateToSearch(query);
        });
      }

      inputEl.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const query = inputEl.value.trim();
          if (query) navigateToSearch(query);
        }
      });
      return;
    }

    if (formEl) {
      formEl.addEventListener('submit', e => e.preventDefault());
    }

    const handleSearchPageInput = debounce(async () => {
      const query = inputEl.value.trim();
      await performGlobalSearch(query);
    }, 300);

    inputEl.addEventListener('input', handleSearchPageInput);

    const urlParams = new URLSearchParams(location.search);
    const initialQuery = urlParams.get('q') || '';
    if (initialQuery) {
      inputEl.value = initialQuery;
      performGlobalSearch(initialQuery);
    }
  }

  return {
    state: globalSearchState,
    getMemoriesSearchText,
    filterMemoriesList,
    buildMemoriesSearchTerms,
    applyGlobalSearch,
    performGlobalSearch,
    attachGlobalSearchInput
  };
}


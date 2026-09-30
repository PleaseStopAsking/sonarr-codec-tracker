const state = {
  view: 'latest', series: [], episodes: new Map(), episodeRequests: new Map(), files: [], movies: [],
  available: { sonarr: false, radarr: false },
  loading: { sonarr: false, radarr: false }, errors: {}, configError: '', progress: '',
  sort: 'date', descending: true, detailSort: 'episode', detailDescending: false,
  pageSize: 250, page: { sonarr: 1, radarr: 1 }, generation: 0, selectedSeries: null
};

const element = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[character]);
const dateValue = (value) => value && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : 0;
const dateLabel = (value) => dateValue(value) ? new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
const sizeLabel = (value) => value > 0 ? `${(value / 1024 ** 3).toFixed(value >= 10 * 1024 ** 3 ? 1 : 2)} GB` : '—';

async function getJson(path) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Check the API key.' : `API returned ${response.status}.`);
  return response.json();
}

function codecOf(file) {
  return file?.mediaInfo?.videoCodec || file?.mediaInfo?.videoCodecId || '—';
}

function resolutionOf(file) {
  return file?.quality?.quality?.resolution ? `${file.quality.quality.resolution}p` : file?.quality?.quality?.name || '—';
}

function filename(file) {
  return (file?.relativePath || file?.path || '').split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'Episode';
}

function sonarrItem(series, file) {
  const matching = state.episodes.get(series.id)?.filter((episode) => episode.episodeFileId === file.id) || [];
  return {
    service: 'sonarr', seriesId: series.id, fileId: file.id, title: series.title,
    detail: matching.length ? matching.map((episode) => `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} · ${episode.title}`).join(' / ') : filename(file),
    date: file.dateAdded, release: matching[0]?.airDateUtc || matching[0]?.airDate,
    codec: codecOf(file), resolution: resolutionOf(file), size: file.size || 0
  };
}

function radarrItem(movie) {
  const file = movie.movieFile;
  return {
    service: 'radarr', title: movie.title, detail: movie.year || 'Movie',
    date: file?.dateAdded || (movie.hasFile ? movie.added : null),
    release: movie.digitalRelease || movie.physicalRelease || movie.inCinemas,
    codec: codecOf(file), resolution: resolutionOf(file), size: file?.size || 0,
    hasFile: Boolean(file || movie.hasFile)
  };
}

async function loadSonarr(generation) {
  try {
    const series = await getJson('/api/sonarr/series');
    if (generation !== state.generation) return;
    state.series = Array.isArray(series) ? series : [];
    cachedLibrarySeries = null;
    render();
    const withFiles = state.series.filter((entry) => entry.statistics?.episodeFileCount !== 0);
    let cursor = 0;
    let failed = 0;
    async function worker() {
      while (cursor < withFiles.length && generation === state.generation) {
        const entry = withFiles[cursor++];
        try {
          const files = await getJson(`/api/sonarr/episodefile?seriesId=${encodeURIComponent(entry.id)}`);
          if (generation !== state.generation) return;
          if (Array.isArray(files)) {
            state.files.push(...files.map((file) => sonarrItem(entry, file)));
            filtersDirty = true;
            cachedLibrarySeries = null;
            if (state.selectedSeries === entry.id) renderDetail();
          }
        } catch (error) {
          failed++;
        }
        if (generation !== state.generation) return;
        state.progress = `Scanning Sonarr · ${cursor} / ${withFiles.length} series`;
        updateProgress();
        scheduleRender();
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, withFiles.length) }, () => worker()));
    if (failed) state.errors.sonarr = `${failed} series could not be loaded. Refresh to retry.`;
  } catch (error) {
    if (generation === state.generation) state.errors.sonarr = error.message;
  } finally {
    if (generation === state.generation) {
      state.loading.sonarr = false;
      state.progress = '';
      render();
    }
  }
}

async function loadRadarr(generation) {
  try {
    const movies = await getJson('/api/radarr/movie');
    if (generation !== state.generation) return;
    state.movies = Array.isArray(movies) ? movies : [];
    filtersDirty = true;
    const withoutFiles = state.movies.filter((movie) => movie.hasFile && !movie.movieFile);
    let cursor = 0;
    let failed = 0;
    async function worker() {
      while (cursor < withoutFiles.length && generation === state.generation) {
        const movie = withoutFiles[cursor++];
        try {
          const files = await getJson(`/api/radarr/moviefile?movieId=${encodeURIComponent(movie.id)}`);
          if (generation !== state.generation) return;
          movie.movieFile = Array.isArray(files) ? files[0] : files;
          filtersDirty = true;
        } catch (error) {
          failed++;
        }
        scheduleRender();
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, withoutFiles.length) }, () => worker()));
    if (failed) state.errors.radarr = `${failed} movie files could not be loaded. Refresh to retry.`;
  } catch (error) {
    if (generation === state.generation) state.errors.radarr = error.message;
  } finally {
    if (generation === state.generation) {
      state.loading.radarr = false;
      render();
    }
  }
}

function loadAll() {
  const generation = ++state.generation;
  clearTimeout(renderTimer);
  renderTimer = null;
  state.series = [];
  state.files = [];
  state.movies = [];
  state.episodes.clear();
  state.episodeRequests.clear();
  state.loading = { ...state.available };
  state.errors = {};
  state.progress = '';
  resetPages();
  filtersDirty = true;
  cachedLibrarySeries = null;
  closeDetail();
  render();
  if (state.available.sonarr) loadSonarr(generation);
  if (state.available.radarr) loadRadarr(generation);
}

async function initialize() {
  try {
    const available = await getJson('/services.json');
    state.available = { sonarr: available.sonarr === true, radarr: available.radarr === true };
  } catch (error) {
    state.configError = `Service settings could not be loaded: ${error.message}`;
  }
  for (const service of ['sonarr', 'radarr']) {
    document.querySelector(`[data-view="${service}"]`).hidden = !state.available[service];
    element('source').querySelector(`option[value="${service}"]`).disabled = !state.available[service];
  }
  loadAll();
}

let renderTimer;
let lastRenderAt = 0;
let filtersDirty = true;
let cachedLibrarySeries = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    lastRenderAt = Date.now();
    render();
  }, Math.max(0, 500 - (Date.now() - lastRenderAt)));
}

function updateProgress() {
  const progress = document.querySelector('.collection.sonarr .progress');
  if (progress) progress.textContent = state.progress;
}

function updateFilters() {
  const current = { codec: element('codec').value, resolution: element('resolution').value };
  const values = [...state.files, ...state.movies.map(radarrItem)];
  for (const key of ['codec', 'resolution']) {
    const select = element(key);
    const options = [...new Set(values.map((item) => item[key]).filter((value) => value && value !== '—'))].sort();
    select.replaceChildren(new Option(`All ${key === 'codec' ? 'codecs' : 'resolutions'}`, ''));
    for (const option of options) select.add(new Option(option, option));
    select.value = options.includes(current[key]) ? current[key] : '';
  }
}

function matches(item, latest = false) {
  const query = element('search').value.trim().toLocaleLowerCase();
  if (query && !`${item.title} ${item.detail}`.toLocaleLowerCase().includes(query)) return false;
  if (element('codec').value && !(item.codecs || [item.codec]).includes(element('codec').value)) return false;
  if (element('resolution').value && !(item.resolutions || [item.resolution]).includes(element('resolution').value)) return false;
  if (latest) {
    const days = Number(element('period').value);
    if (!dateValue(item.date) || (days && dateValue(item.date) < Date.now() - days * 86400000)) return false;
  }
  return true;
}

function order(items) {
  const key = state.sort;
  return [...items].sort((first, second) => {
    const left = key === 'date' || key === 'release' ? dateValue(first[key]) : first[key];
    const right = key === 'date' || key === 'release' ? dateValue(second[key]) : second[key];
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true });
    return (state.descending ? -1 : 1) * (comparison || first.title.localeCompare(second.title));
  });
}

function codecBadge(codec) {
  if (!codec || codec === '—') return '—';
  return `<span class="codec ${/^(h\.?264|x264|avc)$/i.test(codec) ? 'legacy' : ''}">${escapeHtml(codec)}</span>`;
}

function table(items, kind) {
  if (!items.length) return `<div class="empty">${state.loading[kind === 'library-radarr' ? 'radarr' : 'sonarr'] && kind !== 'latest' ? 'Loading media…' : 'No matching media found.'}</div>`;
  const rows = items.map((item) => {
    const title = item.service === 'sonarr'
      ? `<button type="button" class="row-button" data-series-id="${Number(item.seriesId)}">${escapeHtml(item.title)}</button>`
      : `<span class="title">${escapeHtml(item.title)}</span>`;
    const detail = kind === 'library-sonarr' ? `${item.detail} files` : item.detail;
    return `<tr><td>${title}</td><td class="secondary">${escapeHtml(detail)}</td><td class="numeric">${dateLabel(item.release)}</td><td class="numeric">${dateLabel(item.date)}</td><td>${codecBadge(item.codec)}</td><td class="secondary">${escapeHtml(item.resolution)}</td><td class="numeric">${sizeLabel(item.size)}</td></tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="media-table"><thead><tr><th>Title</th><th>${kind === 'library-sonarr' ? 'Episodes' : 'Episode / year'}</th><th>Released</th><th>Added</th><th>Codec</th><th>Resolution</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function section(service, title, items, kind, total = items.length) {
  const loading = state.loading[service];
  return `<section class="collection ${service}"><div class="collection-heading"><div><span class="source-mark"></span><h2>${title}</h2><span class="collection-count">${total} ${kind === 'library-sonarr' ? 'titles' : 'items'}</span></div><span class="collection-count">${loading ? 'Syncing…' : ''}</span></div>${table(items, kind)}${loading ? `<div class="progress">${service === 'sonarr' ? escapeHtml(state.progress || 'Connecting to Sonarr…') : 'Connecting to Radarr…'}</div>` : ''}</section>`;
}

function resetPages() {
  state.page.sonarr = 1;
  state.page.radarr = 1;
}

function libraryPage(service, title, items, kind) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  state.page[service] = Math.max(1, Math.min(state.page[service], pageCount));
  const start = (state.page[service] - 1) * state.pageSize;
  const end = Math.min(start + state.pageSize, total);
  const page = section(service, title, items.slice(start, end), kind, total);
  return `${page}<nav class="pagination" aria-label="${title} pages"><span>${total ? start + 1 : 0}–${end} of ${total} · Page ${state.page[service]} of ${pageCount}</span><div><button type="button" class="icon-button" data-page="-1" title="Previous page" aria-label="Previous page" ${state.page[service] === 1 ? 'disabled' : ''}><i data-lucide="chevron-left" aria-hidden="true"></i></button><button type="button" class="icon-button" data-page="1" title="Next page" aria-label="Next page" ${state.page[service] === pageCount ? 'disabled' : ''}><i data-lucide="chevron-right" aria-hidden="true"></i></button></div></nav>`;
}

function librarySeries() {
  const newest = new Map();
  const counts = new Map();
  const codecs = new Map();
  const resolutions = new Map();
  for (const file of state.files) {
    counts.set(file.seriesId, (counts.get(file.seriesId) || 0) + 1);
    if (!codecs.has(file.seriesId)) codecs.set(file.seriesId, new Set());
    if (!resolutions.has(file.seriesId)) resolutions.set(file.seriesId, new Set());
    codecs.get(file.seriesId).add(file.codec);
    resolutions.get(file.seriesId).add(file.resolution);
    if (!newest.has(file.seriesId) || dateValue(file.date) > dateValue(newest.get(file.seriesId).date)) newest.set(file.seriesId, file);
  }
  return state.series.map((series) => {
    const file = newest.get(series.id);
    return {
      service: 'sonarr', seriesId: series.id, title: series.title,
      detail: counts.get(series.id) || series.statistics?.episodeFileCount || 0,
      date: file?.date || series.added, release: series.firstAired,
      codec: file?.codec || '—', resolution: file?.resolution || '—', size: series.statistics?.sizeOnDisk || 0,
      codecs: [...(codecs.get(series.id) || [])], resolutions: [...(resolutions.get(series.id) || [])]
    };
  });
}

function render() {
  if (filtersDirty) {
    updateFilters();
    filtersDirty = false;
  }
  const latest = state.view === 'latest';
  element('toolbar').hidden = !state.available.sonarr && !state.available.radarr;
  element('stats').hidden = !state.available.sonarr && !state.available.radarr;
  element('page-title').textContent = latest ? 'Latest' : state.view === 'sonarr' ? 'Sonarr library' : 'Radarr library';
  element('page-description').textContent = latest ? 'Recently added episodes and movies across your libraries.' : state.view === 'sonarr' ? 'Browse series and inspect every episode.' : 'Browse movies and compare formats at a glance.';
  element('source-wrap').hidden = !latest || !state.available.sonarr || !state.available.radarr;
  element('period-wrap').hidden = !latest;
  element('page-size-wrap').hidden = latest;
  element('stat-series').parentElement.hidden = !state.available.sonarr;
  element('stat-episodes').parentElement.hidden = !state.available.sonarr;
  element('stat-movies').parentElement.hidden = !state.available.radarr;
  element('stat-files').parentElement.hidden = !state.available.sonarr && !state.available.radarr;
  element('stat-series').textContent = state.loading.sonarr && !state.series.length ? '—' : state.series.length.toLocaleString();
  element('stat-episodes').textContent = state.loading.sonarr && !state.series.length ? '—' : state.series.reduce((count, series) => count + (series.statistics?.episodeCount || 0), 0).toLocaleString();
  element('stat-movies').textContent = state.loading.radarr && !state.movies.length ? '—' : state.movies.length.toLocaleString();
  element('stat-files').textContent = state.loading.sonarr && !state.files.length ? '—' : (state.files.length + state.movies.filter((movie) => movie.hasFile).length).toLocaleString();
  element('refresh').classList.toggle('busy', state.loading.sonarr || state.loading.radarr);
  const source = element('source').value;
  const errors = Object.entries(state.errors).filter(([service]) => latest ? source === 'all' || service === source : service === state.view).map(([service, message]) => `${service === 'sonarr' ? 'Sonarr' : 'Radarr'}: ${message}`);
  if (state.configError) errors.unshift(state.configError);
  element('notice').hidden = !errors.length;
  element('notice').textContent = errors.join(' ');

  let html;
  if (latest) {
    html = (state.available.sonarr && source !== 'radarr' ? section('sonarr', 'Sonarr · Episodes', order(state.files.filter((item) => matches(item, true))).slice(0, 60), 'latest') : '')
      + (state.available.radarr && source !== 'sonarr' ? section('radarr', 'Radarr · Movies', order(state.movies.map(radarrItem).filter((item) => item.hasFile && matches(item, true))).slice(0, 60), 'latest') : '');
    if (!html) html = '<div class="empty">No media services connected.</div>';
  } else if (state.view === 'sonarr') {
    if (!cachedLibrarySeries) cachedLibrarySeries = librarySeries();
    html = libraryPage('sonarr', 'Series', order(cachedLibrarySeries.filter((item) => matches(item))), 'library-sonarr');
  } else {
    html = libraryPage('radarr', 'Movies', order(state.movies.map(radarrItem).filter((item) => matches(item))), 'library-radarr');
  }
  element('content').innerHTML = html;
  if (window.lucide) window.lucide.createIcons();
}

function renderDetail() {
  const series = state.series.find((entry) => entry.id === state.selectedSeries);
  if (!series) return;
  element('detail-title').textContent = series.title;
  const episodes = state.episodes.get(series.id);
  element('detail-subtitle').textContent = episodes ? `${episodes.length} episodes · ${state.files.filter((item) => item.seriesId === series.id).length} files` : 'Loading episodes…';
  if (!episodes) {
    element('detail-body').innerHTML = '<div class="loading-line"></div>';
    return;
  }
  const files = new Map(state.files.filter((item) => item.seriesId === series.id).map((item) => [item.fileId, item]));
  const bySeason = new Map();
  for (const episode of episodes) {
    if (!bySeason.has(episode.seasonNumber)) bySeason.set(episode.seasonNumber, []);
    bySeason.get(episode.seasonNumber).push(episode);
  }
  const episodeSortValue = (episode) => {
    const file = files.get(episode.episodeFileId);
    switch (state.detailSort) {
      case 'title': return episode.title || '';
      case 'release': return dateValue(episode.airDateUtc || episode.airDate);
      case 'date': return dateValue(file?.date);
      case 'codec': return file?.codec || '';
      case 'resolution': return file?.resolution || '';
      case 'size': return file?.size || 0;
      default: return episode.episodeNumber;
    }
  };
  element('detail-body').innerHTML = [...bySeason].sort(([first], [second]) => second - first).map(([season, entries]) => {
    const rows = entries.sort((first, second) => {
      const left = episodeSortValue(first);
      const right = episodeSortValue(second);
      const result = typeof left === 'number' && typeof right === 'number' ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true });
      return (state.detailDescending ? -1 : 1) * (result || first.episodeNumber - second.episodeNumber);
    }).map((episode) => {
      const file = files.get(episode.episodeFileId);
      return `<tr><td><span class="title">${escapeHtml(String(episode.episodeNumber).padStart(2, '0'))} · ${escapeHtml(episode.title)}</span></td><td class="numeric">${dateLabel(episode.airDateUtc || episode.airDate)}</td><td class="numeric">${dateLabel(file?.date)}</td><td>${codecBadge(file?.codec)}</td><td class="secondary">${escapeHtml(file?.resolution || '—')}</td><td class="numeric">${sizeLabel(file?.size)}</td></tr>`;
    }).join('');
    return `<h3 class="season-heading">${season === 0 ? 'Specials' : `Season ${season}`}</h3><div class="table-wrap"><table class="media-table"><thead><tr><th>Episode</th><th>Aired</th><th>Added</th><th>Codec</th><th>Resolution</th><th>Size</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }).join('') || '<div class="empty">No episodes found.</div>';
}

function openDetail(seriesId) {
  state.selectedSeries = seriesId;
  element('detail').hidden = false;
  element('scrim').hidden = false;
  document.body.style.overflow = 'hidden';
  renderDetail();
  element('close-detail').focus();
  if (!state.episodes.has(seriesId) && !state.episodeRequests.has(seriesId)) {
    const generation = state.generation;
    const request = getJson(`/api/sonarr/episode?seriesId=${encodeURIComponent(seriesId)}`)
      .then((episodes) => {
        if (generation !== state.generation) return;
        const loaded = Array.isArray(episodes) ? episodes : [];
        state.episodes.set(seriesId, loaded);
        const byFile = new Map();
        for (const episode of loaded) {
          if (!byFile.has(episode.episodeFileId)) byFile.set(episode.episodeFileId, []);
          byFile.get(episode.episodeFileId).push(episode);
        }
        for (const file of state.files) {
          if (file.seriesId !== seriesId || !byFile.has(file.fileId)) continue;
          const matching = byFile.get(file.fileId);
          file.detail = matching.map((episode) => `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')} · ${episode.title}`).join(' / ');
          file.release = matching[0].airDateUtc || matching[0].airDate;
        }
        if (state.selectedSeries === seriesId) renderDetail();
        scheduleRender();
      })
      .catch((error) => {
        if (generation === state.generation && state.selectedSeries === seriesId) element('detail-body').textContent = `Could not load episodes: ${error.message}`;
      }).finally(() => {
        if (generation === state.generation) state.episodeRequests.delete(seriesId);
      });
    state.episodeRequests.set(seriesId, request);
  }
}

function closeDetail() {
  state.selectedSeries = null;
  element('detail').hidden = true;
  element('scrim').hidden = true;
  document.body.style.overflow = '';
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  state.view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach((item) => {
    item.classList.toggle('active', item === button);
    if (item === button) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  closeDetail();
  render();
}));
element('content').addEventListener('click', (event) => {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton && (state.view === 'sonarr' || state.view === 'radarr')) {
    state.page[state.view] += Number(pageButton.dataset.page);
    render();
    element('content').scrollIntoView({ block: 'start' });
    return;
  }
  const button = event.target.closest('[data-series-id]');
  if (button) openDetail(Number(button.dataset.seriesId));
});
element('refresh').addEventListener('click', loadAll);
element('close-detail').addEventListener('click', closeDetail);
element('scrim').addEventListener('click', closeDetail);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
element('search').addEventListener('input', () => { resetPages(); render(); });
for (const id of ['source', 'period', 'codec', 'resolution']) element(id).addEventListener('change', () => { resetPages(); render(); });
element('page-size').addEventListener('change', (event) => {
  state.pageSize = Number(event.target.value);
  resetPages();
  render();
});
element('sort').addEventListener('change', (event) => {
  state.sort = event.target.value;
  state.descending = state.sort !== 'title' && state.sort !== 'codec';
  resetPages();
  element('direction').title = state.descending ? 'Sort descending' : 'Sort ascending';
  element('direction').setAttribute('aria-label', element('direction').title);
  render();
});
element('direction').addEventListener('click', () => {
  state.descending = !state.descending;
  resetPages();
  element('direction').title = state.descending ? 'Sort descending' : 'Sort ascending';
  element('direction').setAttribute('aria-label', element('direction').title);
  element('direction').innerHTML = `<i data-lucide="${state.descending ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide'}" aria-hidden="true"></i>`;
  render();
});
element('detail-sort').addEventListener('change', (event) => {
  state.detailSort = event.target.value;
  state.detailDescending = !['episode', 'title', 'codec'].includes(state.detailSort);
  renderDetail();
});
element('detail-direction').addEventListener('click', () => {
  state.detailDescending = !state.detailDescending;
  element('detail-direction').title = state.detailDescending ? 'Sort descending' : 'Sort ascending';
  element('detail-direction').setAttribute('aria-label', element('detail-direction').title);
  element('detail-direction').innerHTML = `<i data-lucide="${state.detailDescending ? 'arrow-down-wide-narrow' : 'arrow-up-narrow-wide'}" aria-hidden="true"></i>`;
  renderDetail();
  if (window.lucide) window.lucide.createIcons();
});

initialize();
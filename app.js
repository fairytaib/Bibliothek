/* =========================================================
   ARCHIV — Web-Bibliothekssystem
   app.js — Daten-Fetch, Suche, Filter, Profil- & Themen-Rendering
   ========================================================= */

const DATA_URL = 'data.json';

/**
 * Lädt die zentrale data.json.
 * Gibt ein Array von Professoren-Objekten zurück (oder null bei Fehler).
 */
async function loadData() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch (err) {
    console.error('Konnte data.json nicht laden:', err);
    return null; // null signalisiert einen echten Ladefehler (anders als "leere Liste")
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function themaUrl(themaName) {
  return `thema.html?thema=${encodeURIComponent(themaName)}`;
}

/**
 * Rendert eine Liste von Themen-Strings als klickbare Badges,
 * die zur Themen-Detailseite verlinken.
 */
function themeBadgesHtml(themen, extraClass = '') {
  return (themen || [])
    .map(t => `<a class="badge${extraClass ? ' ' + extraClass : ''}" href="${themaUrl(t)}">${escapeHtml(t)}</a>`)
    .join('');
}

/**
 * Sammelt alle einzigartigen Themen aus dem gesamten Datensatz —
 * sowohl von Professoren als auch von einzelnen Videos/Büchern —
 * inklusive Zähler, wie viele Professoren/Videos/Bücher dazu gehören.
 * Themen werden case-insensitiv zusammengeführt, die erste Schreibweise gewinnt.
 */
function collectAllThemes(data) {
  const map = new Map(); // key: lowercase, value: { label, professoren:Set, videos:0, buecher:0 }

  function touch(name) {
    const key = name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { label: name, professoren: new Set(), videos: 0, buecher: 0 });
    }
    return map.get(key);
  }

  data.forEach(prof => {
    (prof.themen || []).forEach(t => {
      touch(t).professoren.add(prof.id);
    });
    (prof.videos || []).forEach(v => {
      (v.themen || []).forEach(t => {
        const entry = touch(t);
        entry.videos += 1;
        entry.professoren.add(prof.id);
      });
    });
    (prof.buecher || []).forEach(b => {
      (b.themen || []).forEach(t => {
        const entry = touch(t);
        entry.buecher += 1;
        entry.professoren.add(prof.id);
      });
    });
  });

  return [...map.values()]
    .map(e => ({
      label: e.label,
      professorenCount: e.professoren.size,
      videos: e.videos,
      buecher: e.buecher,
      total: e.professoren.size + e.videos + e.buecher
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'de'));
}

/**
 * Findet alle Professoren, Videos und Bücher, die zu einem bestimmten
 * Thema (case-insensitiv) gehören.
 */
function findThemeMatches(data, themaName) {
  const needle = themaName.toLowerCase();

  const professoren = data.filter(prof =>
    (prof.themen || []).some(t => t.toLowerCase() === needle)
  );

  const videos = [];
  const buecher = [];

  data.forEach(prof => {
    (prof.videos || []).forEach(v => {
      if ((v.themen || []).some(t => t.toLowerCase() === needle)) {
        videos.push({ ...v, professor: prof });
      }
    });
    (prof.buecher || []).forEach(b => {
      if ((b.themen || []).some(t => t.toLowerCase() === needle)) {
        buecher.push({ ...b, professor: prof });
      }
    });
  });

  return { professoren, videos, buecher };
}

/* =========================================================
   INDEX-SEITE: Suche, Filter, Karten-Grid
   ========================================================= */

const IndexPage = (() => {
  let allEntries = [];
  let filtered = [];

  const els = {};

  function cacheEls() {
    els.grid = document.getElementById('card-grid');
    els.searchInput = document.getElementById('search-input');
    els.langSelect = document.getElementById('filter-lang');
    els.spezSelect = document.getElementById('filter-spez');
    els.clearBtn = document.getElementById('clear-filters');
    els.resultCount = document.getElementById('result-count');
  }

  function populateFilterOptions() {
    const languages = [...new Set(allEntries.map(e => e.sprache).filter(Boolean))].sort();
    const specializations = [...new Set(allEntries.map(e => e.spezialisierung).filter(Boolean))].sort();

    els.langSelect.innerHTML =
      '<option value="">Alle Sprachen</option>' +
      languages.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');

    els.spezSelect.innerHTML =
      '<option value="">Alle Spezialisierungen</option>' +
      specializations.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  }

  function matchesSearch(entry, query) {
    if (!query) return true;
    const haystack = [
      entry.name,
      entry.sprache,
      entry.spezialisierung,
      ...(entry.themen || [])
    ].join(' ').toLowerCase();
    return haystack.includes(query.toLowerCase());
  }

  function applyFilters() {
    const query = els.searchInput.value.trim();
    const lang = els.langSelect.value;
    const spez = els.spezSelect.value;

    filtered = allEntries.filter(entry => {
      if (lang && entry.sprache !== lang) return false;
      if (spez && entry.spezialisierung !== spez) return false;
      if (!matchesSearch(entry, query)) return false;
      return true;
    });

    render();
  }

  function cardTemplate(entry) {
    const themen = (entry.themen || []).slice(0, 3);
    const extraCount = (entry.themen || []).length - themen.length;

    // Hinweis: Die Karte selbst ist ein <div> (kein <a>), damit die
    // Themen-Badges als eigenständige, nicht verschachtelte Links
    // funktionieren. Die Navigation zum Profil läuft über Event-Delegation
    // (siehe bindCardNavigation) plus die echten Links in Titel/Footer.
    return `
      <div class="prof-card" data-profile-url="profile.html?id=${encodeURIComponent(entry.id)}">
        <h3><a class="card-title-link" href="profile.html?id=${encodeURIComponent(entry.id)}">${escapeHtml(entry.name)}</a></h3>
        <p class="spez">${escapeHtml(entry.spezialisierung || '')}</p>
        <div class="badge-row">
          ${entry.sprache ? `<span class="badge lang">${escapeHtml(entry.sprache)}</span>` : ''}
          ${themeBadgesHtml(themen)}
          ${extraCount > 0 ? `<span class="badge">+${extraCount}</span>` : ''}
        </div>
        ${entry.anmerkung ? `<p class="excerpt">${escapeHtml(entry.anmerkung)}</p>` : ''}
        <div class="card-footer">
          <span class="stat">
            <span>${(entry.videos || []).length} Videos</span>
            <span>${(entry.buecher || []).length} Bücher</span>
          </span>
          <a class="view-link" href="profile.html?id=${encodeURIComponent(entry.id)}">
            Profil ansehen
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </a>
        </div>
      </div>
    `;
  }

  function emptyStateTemplate() {
    return `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>Keine Treffer gefunden</h3>
        <p>Passe deine Suche oder Filter an, um andere Profile zu sehen.</p>
      </div>
    `;
  }

  function render() {
    els.resultCount.textContent = filtered.length;

    if (filtered.length === 0) {
      els.grid.innerHTML = emptyStateTemplate();
      return;
    }

    els.grid.innerHTML = filtered.map(cardTemplate).join('');
  }

  /**
   * Macht die ganze Karte klickbar, ohne <a> ineinander zu verschachteln:
   * Klicks, die bereits auf einem echten Link (Titel, Themen-Badge, "Profil
   * ansehen") landen, werden ignoriert und laufen normal über den Browser.
   * Alle anderen Klicks auf die Karte navigieren zum Profil.
   */
  function bindCardNavigation() {
    els.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.prof-card');
      if (!card) return;
      if (e.target.closest('a')) return; // echter Link übernimmt selbst
      window.location.href = card.dataset.profileUrl;
    });
  }

  async function init() {
    cacheEls();

    const data = await loadData();

    if (data === null) {
      els.grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>Daten konnten nicht geladen werden</h3>
          <p>Bitte stelle sicher, dass "data.json" erreichbar ist und die Seite über einen lokalen Server läuft.</p>
        </div>`;
      els.resultCount.textContent = '0';
      return;
    }

    allEntries = data;
    filtered = [...allEntries];

    populateFilterOptions();
    render();
    bindCardNavigation();

    els.searchInput.addEventListener('input', applyFilters);
    els.langSelect.addEventListener('change', applyFilters);
    els.spezSelect.addEventListener('change', applyFilters);
    els.clearBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      els.langSelect.value = '';
      els.spezSelect.value = '';
      applyFilters();
    });
  }

  return { init };
})();

/* =========================================================
   PROFIL-SEITE: Laden per URL-Parameter, Rendern
   ========================================================= */

const ProfilePage = (() => {
  function getIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('id');
  }

  function resourceItemTemplate(item, type) {
    const icon = type === 'video'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;

    // Der Haupt-Link (Icon + Titel + "Öffnen") und die Themen-Badges sind
    // bewusst zwei getrennte Geschwister-Elemente statt verschachtelter <a>-Tags.
    return `
      <li class="resource-item">
        <a class="resource-main" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <span class="icon">${icon}</span>
          <span class="label">${escapeHtml(item.titel)}</span>
          <span class="go">Öffnen ↗</span>
        </a>
        ${(item.themen && item.themen.length) ? `<div class="resource-themes">${themeBadgesHtml(item.themen, 'badge-sm')}</div>` : ''}
      </li>
    `;
  }

  function renderProfile(entry) {
    document.title = `${entry.name} — ARCHIV`;

    document.getElementById('profile-name').textContent = entry.name;
    document.getElementById('profile-spez').textContent = entry.spezialisierung || '';

    const langBadge = document.getElementById('profile-lang-badge');
    if (entry.sprache) {
      langBadge.textContent = entry.sprache;
      langBadge.style.display = '';
    } else {
      langBadge.style.display = 'none';
    }

    const topicList = document.getElementById('profile-topics');
    topicList.innerHTML = themeBadgesHtml(entry.themen || []);

    const noteEl = document.getElementById('profile-note');
    const notePanel = document.getElementById('note-panel');
    if (entry.anmerkung) {
      noteEl.textContent = entry.anmerkung;
      notePanel.style.display = '';
    } else {
      notePanel.style.display = 'none';
    }

    const videosEl = document.getElementById('profile-videos');
    const videosPanel = document.getElementById('videos-panel');
    if ((entry.videos || []).length > 0) {
      videosEl.innerHTML = entry.videos.map(v => resourceItemTemplate(v, 'video')).join('');
      videosPanel.style.display = '';
    } else {
      videosPanel.style.display = 'none';
    }

    const buecherEl = document.getElementById('profile-buecher');
    const buecherPanel = document.getElementById('buecher-panel');
    if ((entry.buecher || []).length > 0) {
      buecherEl.innerHTML = entry.buecher.map(b => resourceItemTemplate(b, 'buch')).join('');
      buecherPanel.style.display = '';
    } else {
      buecherPanel.style.display = 'none';
    }

    document.getElementById('profile-content').style.display = '';
    document.getElementById('not-found-state').style.display = 'none';
    document.getElementById('loading-state').style.display = 'none';
  }

  function renderNotFound() {
    document.getElementById('profile-content').style.display = 'none';
    document.getElementById('loading-state').style.display = 'none';
    document.getElementById('not-found-state').style.display = '';
  }

  async function init() {
    const id = getIdFromUrl();
    const data = await loadData();

    if (!id || !data) {
      renderNotFound();
      return;
    }

    const entry = data.find(e => e.id === id);

    if (!entry) {
      renderNotFound();
      return;
    }

    renderProfile(entry);
  }

  return { init };
})();

/* =========================================================
   THEMEN-ÜBERSICHT: Badge-Wolke aller Themen mit Zählern
   ========================================================= */

const ThemenPage = (() => {
  let allThemes = [];
  const els = {};

  function cacheEls() {
    els.cloud = document.getElementById('themen-cloud');
    els.searchInput = document.getElementById('themen-search');
    els.count = document.getElementById('themen-count');
  }

  function themeCardTemplate(theme) {
    const parts = [];
    if (theme.videos > 0) parts.push(`${theme.videos} Video${theme.videos === 1 ? '' : 's'}`);
    if (theme.buecher > 0) parts.push(`${theme.buecher} Buch${theme.buecher === 1 ? '' : '-Einträge'}`.replace('Buch-Einträge', 'Bücher'));
    if (theme.professorenCount > 0) parts.push(`${theme.professorenCount} Professor${theme.professorenCount === 1 ? '' : 'en'}`);

    return `
      <a class="theme-tile" href="${themaUrl(theme.label)}">
        <span class="theme-tile-name">${escapeHtml(theme.label)}</span>
        <span class="theme-tile-meta">${parts.join(' · ') || 'Keine Einträge'}</span>
      </a>
    `;
  }

  function render(filterQuery = '') {
    const query = filterQuery.trim().toLowerCase();
    const visible = query
      ? allThemes.filter(t => t.label.toLowerCase().includes(query))
      : allThemes;

    els.count.textContent = visible.length;

    if (visible.length === 0) {
      els.cloud.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>Keine Themen gefunden</h3>
          <p>Passe deine Suche an, um andere Themen zu sehen.</p>
        </div>`;
      return;
    }

    els.cloud.innerHTML = visible.map(themeCardTemplate).join('');
  }

  async function init() {
    cacheEls();
    const data = await loadData();

    if (data === null) {
      els.cloud.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>Daten konnten nicht geladen werden</h3>
          <p>Bitte stelle sicher, dass "data.json" erreichbar ist und die Seite über einen lokalen Server läuft.</p>
        </div>`;
      return;
    }

    allThemes = collectAllThemes(data);
    render();

    els.searchInput.addEventListener('input', () => render(els.searchInput.value));
  }

  return { init };
})();

/* =========================================================
   THEMEN-DETAILSEITE: Alle Videos/Bücher/Professoren zu einem Thema
   ========================================================= */

const ThemaPage = (() => {
  function getThemaFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('thema');
  }

  function profCardTemplate(prof) {
    return `
      <a class="theme-prof-card" href="profile.html?id=${encodeURIComponent(prof.id)}">
        <span class="theme-prof-name">${escapeHtml(prof.name)}</span>
        <span class="theme-prof-spez">${escapeHtml(prof.spezialisierung || '')}</span>
      </a>
    `;
  }

  function resourceTemplate(item, type) {
    const icon = type === 'video'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>`;

    return `
      <li class="resource-item">
        <a class="resource-main" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <span class="icon">${icon}</span>
          <span class="label">${escapeHtml(item.titel)}</span>
          <span class="go">Öffnen ↗</span>
        </a>
        <div class="resource-themes">
          <a class="badge badge-sm prof-tag" href="profile.html?id=${encodeURIComponent(item.professor.id)}">${escapeHtml(item.professor.name)}</a>
        </div>
      </li>
    `;
  }

  function render(themaName, matches) {
    document.title = `${themaName} — Thema — ARCHIV`;
    document.getElementById('thema-title').textContent = themaName;

    const total = matches.professoren.length + matches.videos.length + matches.buecher.length;
    document.getElementById('thema-summary').textContent =
      `${matches.videos.length} Video${matches.videos.length === 1 ? '' : 's'} · ${matches.buecher.length} Buch${matches.buecher.length === 1 ? '' : '-Einträge'}`.replace('Buch-Einträge', 'Bücher') +
      ` · ${matches.professoren.length} Professor${matches.professoren.length === 1 ? '' : 'en'}`;

    const profPanel = document.getElementById('thema-professoren-panel');
    const profList = document.getElementById('thema-professoren');
    if (matches.professoren.length > 0) {
      profList.innerHTML = matches.professoren.map(profCardTemplate).join('');
      profPanel.style.display = '';
    } else {
      profPanel.style.display = 'none';
    }

    const videosPanel = document.getElementById('thema-videos-panel');
    const videosList = document.getElementById('thema-videos');
    if (matches.videos.length > 0) {
      videosList.innerHTML = matches.videos.map(v => resourceTemplate(v, 'video')).join('');
      videosPanel.style.display = '';
    } else {
      videosPanel.style.display = 'none';
    }

    const buecherPanel = document.getElementById('thema-buecher-panel');
    const buecherList = document.getElementById('thema-buecher');
    if (matches.buecher.length > 0) {
      buecherList.innerHTML = matches.buecher.map(b => resourceTemplate(b, 'buch')).join('');
      buecherPanel.style.display = '';
    } else {
      buecherPanel.style.display = 'none';
    }

    document.getElementById('thema-content').style.display = total > 0 ? '' : 'none';
    document.getElementById('thema-empty-state').style.display = total > 0 ? 'none' : '';
    document.getElementById('thema-loading-state').style.display = 'none';
  }

  function renderNotFound() {
    document.getElementById('thema-content').style.display = 'none';
    document.getElementById('thema-loading-state').style.display = 'none';
    document.getElementById('thema-not-found-state').style.display = '';
  }

  async function init() {
    const thema = getThemaFromUrl();
    const data = await loadData();

    if (!thema || !data) {
      renderNotFound();
      return;
    }

    const matches = findThemeMatches(data, thema);
    render(thema, matches);
  }

  return { init };
})();

/* =========================================================
   Auto-Init je nach Seite
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('card-grid')) {
    IndexPage.init();
  }
  if (document.getElementById('profile-content')) {
    ProfilePage.init();
  }
  if (document.getElementById('themen-cloud')) {
    ThemenPage.init();
  }
  if (document.getElementById('thema-content')) {
    ThemaPage.init();
  }
});

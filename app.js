/* =========================================================
   ARCHIV — Web-Bibliothekssystem
   app.js — Daten-Fetch, Suche, Filter, Profil-Rendering
   ========================================================= */

const DATA_URL = 'data.json';

/**
 * Lädt die zentrale data.json.
 * Gibt ein Array von Professoren-Objekten zurück (oder [] bei Fehler).
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

    return `
      <a class="prof-card" href="profile.html?id=${encodeURIComponent(entry.id)}">
        <h3>${escapeHtml(entry.name)}</h3>
        <p class="spez">${escapeHtml(entry.spezialisierung || '')}</p>
        <div class="badge-row">
          ${entry.sprache ? `<span class="badge lang">${escapeHtml(entry.sprache)}</span>` : ''}
          ${themen.map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
          ${extraCount > 0 ? `<span class="badge">+${extraCount}</span>` : ''}
        </div>
        ${entry.anmerkung ? `<p class="excerpt">${escapeHtml(entry.anmerkung)}</p>` : ''}
        <div class="card-footer">
          <span class="stat">
            <span>${(entry.videos || []).length} Videos</span>
            <span>${(entry.buecher || []).length} Bücher</span>
          </span>
          <span class="view-link">
            Profil ansehen
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </span>
        </div>
      </a>
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

    return `
      <li>
        <a class="resource-item" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
          <span class="icon">${icon}</span>
          <span class="label">${escapeHtml(item.titel)}</span>
          <span class="go">Öffnen ↗</span>
        </a>
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
    topicList.innerHTML = (entry.themen || [])
      .map(t => `<span class="badge">${escapeHtml(t)}</span>`)
      .join('');

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
   Auto-Init je nach Seite
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('card-grid')) {
    IndexPage.init();
  }
  if (document.getElementById('profile-content')) {
    ProfilePage.init();
  }
});

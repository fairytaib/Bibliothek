/* =========================================================
   ARCHIV — HDI-Bibliothek
   app.js — gemeinsame Hilfsfunktionen und Seitenlogik für
   Gelehrte (index.html), Profil (profile.html),
   Themen-Übersicht (themen.html) und Thema (thema.html).

   admin.html bindet diese Datei ebenfalls ein und nutzt die
   Hilfsfunktionen (Laden, Tags, Escaping). Die Seiten-Module
   starten nur, wenn ihre Elemente auf der Seite vorhanden sind.
   ========================================================= */

const DATA_URL = 'data.json';
const TAGS_URL = 'tags.json';
const GENERAL_ID = 'allgemein'; // Sammel-Eintrag „Allgemein“ wird immer zuletzt sortiert

/* =========================================================
   Laden
   ========================================================= */

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Lädt data.json. Gibt die Liste der Gelehrten zurück oder null bei
 * einem Ladefehler (Datei fehlt, ungültiges JSON, kein Array).
 * Leere/kaputte Elemente (z. B. durch ein überzähliges Komma) werden
 * herausgefiltert, damit ein einzelner Fehler nicht die Seite lahmlegt.
 */
async function loadData() {
  try {
    const json = await fetchJson(DATA_URL);
    if (!Array.isArray(json)) throw new Error('data.json enthält keine Liste ([ … ]).');
    return json.filter(entry => entry && typeof entry === 'object');
  } catch (err) {
    console.error('Konnte data.json nicht laden:', err);
    return null;
  }
}

/**
 * Lädt tags.json und bereitet sie auf. Fehlt die Datei, entsteht eine
 * leere Konfiguration – unbekannte Tags gelten dann als Themen.
 */
async function loadTagConfig() {
  let raw = null;
  try {
    raw = await fetchJson(TAGS_URL);
  } catch (err) {
    console.warn('Konnte tags.json nicht laden:', err);
  }
  return buildTagConfig(raw);
}

/**
 * Wandelt den Inhalt von tags.json in eine Struktur mit schnellem
 * Nachschlagen um. Unterstützt auch das alte Format (flache Liste).
 */
function buildTagConfig(raw) {
  if (Array.isArray(raw)) {
    raw = { gruppen: [{ id: 'themen', name: 'Themen', art: 'thema', tags: raw }] };
  }
  if (!raw || typeof raw !== 'object') raw = {};

  const cfg = {
    sprachen: Array.isArray(raw.sprachen)
      ? raw.sprachen.filter(s => typeof s === 'string' && s.trim())
      : [],
    gruppen: [],
    info: new Map(),  // kleingeschriebener Tag-Name → { name, beschreibung, gruppe }
    themaTags: []     // alle Tags aus Gruppen mit art "thema", in Dateireihenfolge
  };

  (Array.isArray(raw.gruppen) ? raw.gruppen : []).forEach((g, index) => {
    if (!g || typeof g !== 'object' || !Array.isArray(g.tags)) return;
    const art = g.art === 'filter' ? 'filter' : 'thema';
    const gruppe = {
      id: String(g.id || `gruppe-${index}`),
      name: String(g.name || ''),
      art,
      regel: String(g.regel || (art === 'thema' ? 'inhalt' : 'optional')),
      nurVideo: Boolean(g.nurVideo),
      hinweis: String(g.hinweis || ''),
      tags: []
    };

    g.tags.forEach(t => {
      const tag = typeof t === 'string' ? { name: t } : t;
      if (!tag || typeof tag.name !== 'string' || !tag.name.trim()) return;
      const key = tag.name.toLowerCase();
      if (cfg.info.has(key)) return; // doppelt definierte Tags ignorieren
      const entry = { name: tag.name, beschreibung: String(tag.beschreibung || ''), gruppe };
      gruppe.tags.push(entry);
      cfg.info.set(key, entry);
      if (art === 'thema') cfg.themaTags.push(entry.name);
    });

    cfg.gruppen.push(gruppe);
  });

  return cfg;
}

/* =========================================================
   Tags
   ========================================================= */

function tagInfo(cfg, name) {
  return cfg.info.get(String(name ?? '').toLowerCase()) || null;
}

/** Inhaltliches Thema? Unbekannte Tags zählen als Thema, damit nichts verschwindet. */
function isThemaTag(cfg, name) {
  const info = tagInfo(cfg, name);
  return !info || info.gruppe.art === 'thema';
}

/** Schreibweise aus tags.json (z. B. „quran“ → „Quran“). */
function tagLabel(cfg, name) {
  return tagInfo(cfg, name)?.name || String(name ?? '');
}

/** Ersten Tag einer bestimmten Gruppe finden (z. B. Format oder Niveau). */
function tagFromGroup(cfg, themen, gruppenId) {
  const hit = (themen || []).find(t => tagInfo(cfg, t)?.gruppe.id === gruppenId);
  return hit ? tagLabel(cfg, hit) : '';
}

/* =========================================================
   Text, URLs, Sortierung
   ========================================================= */

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Für die Suche: klein, ohne Akzente/Umlautpunkte, ohne Apostrophe (Qur'an = Quran). */
function normalizeText(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`´ʿʾ]/g, '');
}

function searchTerms(query) {
  return normalizeText(query).split(/\s+/).filter(Boolean);
}

/** Nur http(s)-Links zulassen, alles andere wird zu „#“. */
function safeUrl(url) {
  const s = String(url ?? '').trim();
  return /^https?:\/\//i.test(s) ? s : '#';
}

function themaUrl(name) {
  return `thema.html?thema=${encodeURIComponent(name)}`;
}

function profileUrl(id) {
  return `profile.html?id=${encodeURIComponent(id)}`;
}

function countLabel(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}

/** Alphabetisch nach Namen, der Sammel-Eintrag „Allgemein“ zuletzt. */
function sortProfessors(list) {
  return [...list].sort((a, b) => {
    if (a.id === GENERAL_ID && b.id !== GENERAL_ID) return 1;
    if (b.id === GENERAL_ID && a.id !== GENERAL_ID) return -1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'de', { sensitivity: 'base' });
  });
}

/** Werte eindeutig machen und nach einer bevorzugten Reihenfolge sortieren, Rest alphabetisch. */
function orderByList(values, preferred) {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.sort((a, b) => {
    const ia = preferred.indexOf(a);
    const ib = preferred.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
    }
    return a.localeCompare(b, 'de');
  });
}

/* =========================================================
   Videos & Bücher („Ressourcen“)
   ========================================================= */

/**
 * Alle Videos und Bücher eines Gelehrten als einheitliche Objekte.
 * Die Sprache eines Eintrags ist seine eigene "sprache" oder – wenn
 * nicht gesetzt – die Sprache des Gelehrten.
 */
function professorResources(prof) {
  const list = [];
  const add = (items, kind) => {
    (Array.isArray(items) ? items : []).forEach(item => {
      if (!item || typeof item !== 'object' || !item.titel) return;
      list.push({
        titel: String(item.titel),
        url: item.url,
        themen: Array.isArray(item.themen) ? item.themen.filter(t => typeof t === 'string') : [],
        kind,
        sprache: String(item.sprache || prof.sprache || ''),
        prof
      });
    });
  };
  add(prof.videos, 'video');
  add(prof.buecher, 'buch');
  return list;
}

function allResources(data) {
  return data.flatMap(professorResources);
}

function resourceFormat(cfg, r) {
  return r.kind === 'buch' ? 'Buch' : tagFromGroup(cfg, r.themen, 'format');
}

function resourceNiveau(cfg, r) {
  return tagFromGroup(cfg, r.themen, 'niveau');
}

/** Themen eines Gelehrten, gesammelt aus seinen Videos/Büchern, häufigste zuerst. */
function professorThemes(cfg, prof) {
  const counts = new Map();
  professorResources(prof).forEach(r => {
    new Set(r.themen.filter(t => isThemaTag(cfg, t)).map(t => tagLabel(cfg, t))).forEach(label => {
      counts.set(label, (counts.get(label) || 0) + 1);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
    .map(([name]) => name);
}

/** Filter: { sprache, thema, niveau, format } – leere Werte werden ignoriert. */
function matchesResourceFilters(cfg, r, f) {
  if (f.sprache && r.sprache !== f.sprache) return false;
  if (f.thema && !r.themen.some(t => t.toLowerCase() === f.thema.toLowerCase())) return false;
  if (f.niveau && resourceNiveau(cfg, r) !== f.niveau) return false;
  if (f.format && resourceFormat(cfg, r) !== f.format) return false;
  return true;
}

/* =========================================================
   Suche
   Jedes Suchwort muss irgendwo vorkommen. Die Punktzahl richtet
   sich danach, wo es vorkommt (Titel zählt mehr als Beschreibung).
   ========================================================= */

function scoreFields(fields, terms) {
  if (terms.length === 0) return 1;
  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const [text, weight] of fields) {
      if (weight > best && text.includes(term)) best = weight;
    }
    if (best === 0) return 0;
    score += best;
  }
  return score;
}

function resourceScore(cfg, r, terms) {
  if (terms.length === 0) return 1;
  return scoreFields([
    [normalizeText(r.titel), 4],
    [normalizeText(r.themen.map(t => tagLabel(cfg, t)).join(' ')), 3],
    [normalizeText(r.prof.name), 2],
    [normalizeText(r.themen.map(t => tagInfo(cfg, t)?.beschreibung || '').join(' ')), 1]
  ], terms);
}

function professorScore(cfg, prof, terms) {
  if (terms.length === 0) return 1;
  return scoreFields([
    [normalizeText(prof.name), 4],
    [normalizeText(prof.spezialisierung), 3],
    [normalizeText(professorThemes(cfg, prof).join(' ')), 3],
    [normalizeText(prof.anmerkung), 1]
  ], terms);
}

/* =========================================================
   Gemeinsame Bausteine fürs Rendern
   ========================================================= */

const ICONS = {
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>',
  buch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>'
};

/** Tags als klickbare Badges. Format/Niveau/Zugang erscheinen dezenter (Klasse "meta"). */
function themeBadgesHtml(cfg, themen, extraClass = '') {
  return (themen || []).map(t => {
    const label = tagLabel(cfg, t);
    const info = tagInfo(cfg, t);
    const cls = ['badge', extraClass, isThemaTag(cfg, t) ? '' : 'meta'].filter(Boolean).join(' ');
    const title = info?.beschreibung ? ` title="${escapeHtml(info.beschreibung)}"` : '';
    return `<a class="${cls}" href="${themaUrl(label)}"${title}>${escapeHtml(label)}</a>`;
  }).join('');
}

/**
 * Ein Video/Buch als Listeneintrag.
 * showProf: Badge mit dem Gelehrten anzeigen
 * showLang: 'always' | 'differs' (nur wenn abweichend vom Gelehrten) | 'never'
 */
function resourceItemHtml(cfg, r, { showProf = false, showLang = 'always' } = {}) {
  const ordered = [
    ...r.themen.filter(t => isThemaTag(cfg, t)),
    ...r.themen.filter(t => !isThemaTag(cfg, t))
  ];
  const langVisible = r.sprache && (
    showLang === 'always' ||
    (showLang === 'differs' && r.sprache !== (r.prof.sprache || ''))
  );

  const badges = [
    showProf ? `<a class="badge badge-sm prof-tag" href="${profileUrl(r.prof.id)}">${escapeHtml(r.prof.name)}</a>` : '',
    langVisible ? `<span class="badge badge-sm lang">${escapeHtml(r.sprache)}</span>` : '',
    themeBadgesHtml(cfg, ordered, 'badge-sm')
  ].join('');

  const kindLabel = r.kind === 'buch' ? 'Buch' : 'Video';

  // Haupt-Link und Badges sind Geschwister, keine verschachtelten <a>-Tags.
  return `
    <li class="resource-item">
      <a class="resource-main" href="${escapeHtml(safeUrl(r.url))}" target="_blank" rel="noopener noreferrer">
        <span class="icon" title="${kindLabel}">${ICONS[r.kind] || ICONS.video}</span>
        <span class="label">${escapeHtml(r.titel)}</span>
        <span class="go">Öffnen ↗</span>
      </a>
      ${badges ? `<div class="resource-themes">${badges}</div>` : ''}
    </li>
  `;
}

/**
 * Füllt ein <select> mit einer Platzhalter-Option und Optionen
 * ({ value, label?, group? }). Eine passende bisherige Auswahl bleibt erhalten.
 */
function fillSelect(select, placeholder, options) {
  const previous = select.value;
  let html = `<option value="">${escapeHtml(placeholder)}</option>`;
  let openGroup = null;
  options.forEach(o => {
    const group = o.group || null;
    if (group !== openGroup) {
      if (openGroup) html += '</optgroup>';
      if (group) html += `<optgroup label="${escapeHtml(group)}">`;
      openGroup = group;
    }
    html += `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label ?? o.value)}</option>`;
  });
  if (openGroup) html += '</optgroup>';
  select.innerHTML = html;
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}

/* ---------- Optionen für Filter ---------- */

function languageOptions(cfg, resources, profs = []) {
  const values = [...resources.map(r => r.sprache), ...profs.map(p => p.sprache || '')];
  return orderByList(values, cfg.sprachen).map(v => ({ value: v }));
}

function themaOptions(cfg, resources) {
  const used = new Map(); // Label → Anzahl Einträge
  resources.forEach(r => {
    new Set(r.themen.filter(t => isThemaTag(cfg, t)).map(t => tagLabel(cfg, t))).forEach(label => {
      used.set(label, (used.get(label) || 0) + 1);
    });
  });

  const options = [];
  cfg.gruppen.filter(g => g.art === 'thema').forEach(g => {
    g.tags.forEach(t => {
      if (!used.has(t.name)) return;
      options.push({ value: t.name, label: `${t.name} (${used.get(t.name)})`, group: g.name });
      used.delete(t.name);
    });
  });
  // Themen, die in data.json vorkommen, aber nicht in tags.json stehen
  [...used.keys()].sort((a, b) => a.localeCompare(b, 'de')).forEach(label => {
    options.push({ value: label, label: `${label} (${used.get(label)})`, group: 'Weitere' });
  });
  return options;
}

function groupOptions(cfg, resources, gruppenId) {
  const gruppe = cfg.gruppen.find(g => g.id === gruppenId);
  if (!gruppe) return [];
  const used = new Set(resources.map(r => tagFromGroup(cfg, r.themen, gruppenId)).filter(Boolean));
  return gruppe.tags.filter(t => used.has(t.name)).map(t => ({ value: t.name }));
}

function formatOptions(cfg, resources) {
  const formatGroup = cfg.gruppen.find(g => g.id === 'format');
  const preferred = [...(formatGroup ? formatGroup.tags.map(t => t.name) : []), 'Buch'];
  return orderByList(resources.map(r => resourceFormat(cfg, r)), preferred).map(v => ({ value: v }));
}

function spezOptions(cfg, profs) {
  return orderByList(profs.map(p => p.spezialisierung || ''), ['Allrounder', ...cfg.themaTags])
    .map(v => ({ value: v }));
}

function errorStateHtml(title, text) {
  return `
    <div class="empty-state" style="grid-column: 1 / -1;">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(text)}</p>
    </div>`;
}

/* =========================================================
   GELEHRTE (index.html): Suche über Gelehrte, Videos & Bücher
   ========================================================= */

const IndexPage = (() => {
  const RESOURCE_LIMIT = 30;
  let cfg = buildTagConfig(null);
  let profs = [];
  let resources = [];
  let resourcesByProf = new Map();
  let showAllResources = false;
  const els = {};

  function cacheEls() {
    els.search = document.getElementById('search-input');
    els.lang = document.getElementById('filter-lang');
    els.thema = document.getElementById('filter-thema');
    els.niveau = document.getElementById('filter-niveau');
    els.format = document.getElementById('filter-format');
    els.spez = document.getElementById('filter-spez');
    els.clear = document.getElementById('clear-filters');
    els.resSection = document.getElementById('resource-section');
    els.resList = document.getElementById('resource-list');
    els.resCount = document.getElementById('resource-count');
    els.resMore = document.getElementById('resource-more');
    els.grid = document.getElementById('card-grid');
    els.profCount = document.getElementById('result-count');
  }

  function populateFilters() {
    const setup = (select, placeholder, options) => {
      fillSelect(select, placeholder, options);
      select.hidden = options.length === 0;
    };
    setup(els.lang, 'Alle Sprachen', languageOptions(cfg, resources, profs));
    setup(els.thema, 'Alle Themen', themaOptions(cfg, resources));
    setup(els.niveau, 'Alle Niveaus', groupOptions(cfg, resources, 'niveau'));
    setup(els.format, 'Alle Formate', formatOptions(cfg, resources));
    setup(els.spez, 'Alle Spezialisierungen', spezOptions(cfg, profs));
  }

  function readState() {
    return {
      terms: searchTerms(els.search.value),
      filters: {
        sprache: els.lang.value,
        thema: els.thema.value,
        niveau: els.niveau.value,
        format: els.format.value
      },
      spez: els.spez.value
    };
  }

  function applyFilters() {
    const { terms, filters, spez } = readState();
    const filtersActive = Object.values(filters).some(Boolean);
    const searchActive = terms.length > 0 || filtersActive;
    const onlyLanguage = filters.sprache && !filters.thema && !filters.niveau && !filters.format;

    // Videos & Bücher: nur bei Suche oder Video-Filtern anzeigen
    let resourceHits = [];
    if (searchActive) {
      resourceHits = resources
        .filter(r => (!spez || r.prof.spezialisierung === spez) && matchesResourceFilters(cfg, r, filters))
        .map(r => ({ r, score: resourceScore(cfg, r, terms) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || a.r.titel.localeCompare(b.r.titel, 'de'))
        .map(x => x.r);
    }

    // Gelehrte: passen selbst (Name, Spezialisierung, Themen) oder über eines ihrer Videos/Bücher
    const profHits = profs.filter(p => {
      if (spez && p.spezialisierung !== spez) return false;
      if (!searchActive) return true;

      const own = resourcesByProf.get(p) || [];
      const viaResource = own.some(r =>
        matchesResourceFilters(cfg, r, filters) && resourceScore(cfg, r, terms) > 0
      );
      if (viaResource) return true;

      const passesFilters = !filtersActive
        || own.some(r => matchesResourceFilters(cfg, r, filters))
        || (onlyLanguage && p.sprache === filters.sprache);
      return passesFilters && professorScore(cfg, p, terms) > 0;
    });

    renderResources(resourceHits, searchActive);
    renderProfessors(profHits);
  }

  function renderResources(hits, visible) {
    els.resSection.hidden = !visible;
    if (!visible) return;

    els.resCount.textContent = hits.length;
    if (hits.length === 0) {
      els.resList.innerHTML = '<li class="list-empty">Keine passenden Videos oder Bücher gefunden.</li>';
      els.resMore.hidden = true;
      return;
    }

    const shown = showAllResources ? hits : hits.slice(0, RESOURCE_LIMIT);
    els.resList.innerHTML = shown
      .map(r => resourceItemHtml(cfg, r, { showProf: true, showLang: 'always' }))
      .join('');
    els.resMore.hidden = shown.length >= hits.length;
    els.resMore.textContent = `Alle ${hits.length} Treffer anzeigen`;
  }

  function cardTemplate(entry) {
    const themen = professorThemes(cfg, entry);
    const shown = themen.slice(0, 3);
    const extra = themen.length - shown.length;
    const videos = (entry.videos || []).length;
    const buecher = (entry.buecher || []).length;
    const url = profileUrl(entry.id);

    // Die Karte ist ein <div>, damit die Themen-Badges eigene Links sein
    // können. Klicks auf freie Flächen führen per Event-Delegation zum Profil.
    return `
      <div class="prof-card" data-profile-url="${escapeHtml(url)}">
        <h3><a class="card-title-link" href="${escapeHtml(url)}">${escapeHtml(entry.name)}</a></h3>
        ${entry.spezialisierung ? `<p class="spez">${escapeHtml(entry.spezialisierung)}</p>` : ''}
        <div class="badge-row">
          ${entry.sprache ? `<span class="badge lang">${escapeHtml(entry.sprache)}</span>` : ''}
          ${themeBadgesHtml(cfg, shown)}
          ${extra > 0 ? `<span class="badge">+${extra}</span>` : ''}
        </div>
        ${entry.anmerkung ? `<p class="excerpt">${escapeHtml(entry.anmerkung)}</p>` : ''}
        <div class="card-footer">
          <span class="stat">
            <span>${countLabel(videos, 'Video', 'Videos')}</span>
            <span>${countLabel(buecher, 'Buch', 'Bücher')}</span>
          </span>
          <a class="view-link" href="${escapeHtml(url)}">
            Profil ansehen
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
          </a>
        </div>
      </div>
    `;
  }

  function renderProfessors(list) {
    els.profCount.textContent = list.length;
    els.grid.innerHTML = list.length
      ? list.map(cardTemplate).join('')
      : errorStateHtml('Keine Gelehrten gefunden', 'Passe deine Suche oder die Filter an.');
  }

  function bindCardNavigation() {
    els.grid.addEventListener('click', e => {
      const card = e.target.closest('.prof-card');
      if (!card || e.target.closest('a')) return; // echte Links übernehmen selbst
      window.location.href = card.dataset.profileUrl;
    });
  }

  function bindEvents() {
    const refresh = () => {
      showAllResources = false;
      applyFilters();
    };
    els.search.addEventListener('input', refresh);
    [els.lang, els.thema, els.niveau, els.format, els.spez].forEach(s => s.addEventListener('change', refresh));
    els.clear.addEventListener('click', () => {
      els.search.value = '';
      [els.lang, els.thema, els.niveau, els.format, els.spez].forEach(s => { s.value = ''; });
      refresh();
    });
    els.resMore.addEventListener('click', () => {
      showAllResources = true;
      applyFilters();
    });
  }

  async function init() {
    cacheEls();
    const [data, tagCfg] = await Promise.all([loadData(), loadTagConfig()]);
    cfg = tagCfg;

    if (data === null) {
      els.grid.innerHTML = errorStateHtml(
        'Daten konnten nicht geladen werden',
        'Bitte prüfe, ob "data.json" erreichbar ist und gültiges JSON enthält. Details stehen in der Browser-Konsole.'
      );
      els.profCount.textContent = '0';
      return;
    }

    try {
      profs = sortProfessors(data);
      resources = allResources(profs);
      resourcesByProf = new Map(profs.map(p => [p, resources.filter(r => r.prof === p)]));
      populateFilters();
      bindEvents();
      bindCardNavigation();
      applyFilters();
    } catch (err) {
      console.error('Fehler beim Aufbau der Übersicht:', err);
      els.grid.innerHTML = errorStateHtml(
        'Beim Anzeigen ist ein Fehler aufgetreten',
        'Prüfe, ob "data.json" und "tags.json" gültiges JSON enthalten. Details stehen in der Browser-Konsole.'
      );
      els.profCount.textContent = '0';
    }
  }

  return { init };
})();

/* =========================================================
   PROFIL (profile.html)
   ========================================================= */

const ProfilePage = (() => {
  let cfg = buildTagConfig(null);

  function show(state) {
    document.getElementById('loading-state').style.display = state === 'loading' ? '' : 'none';
    document.getElementById('not-found-state').style.display = state === 'not-found' ? '' : 'none';
    document.getElementById('profile-content').style.display = state === 'content' ? '' : 'none';
  }

  function renderList(panelId, listId, items) {
    const panel = document.getElementById(panelId);
    const list = document.getElementById(listId);
    panel.style.display = items.length ? '' : 'none';
    list.innerHTML = items.map(r => resourceItemHtml(cfg, r, { showLang: 'differs' })).join('');
  }

  function renderProfile(entry) {
    document.title = `${entry.name} — ARCHIV`;
    document.getElementById('profile-name').textContent = entry.name;

    // Spezialisierung verlinkt auf das gleichnamige Thema, wenn es eines gibt
    const spezEl = document.getElementById('profile-spez');
    const spez = entry.spezialisierung || '';
    spezEl.innerHTML = spez && tagInfo(cfg, spez)
      ? `<a href="${themaUrl(tagLabel(cfg, spez))}">${escapeHtml(spez)}</a>`
      : escapeHtml(spez);

    const langBadge = document.getElementById('profile-lang-badge');
    langBadge.textContent = entry.sprache || '';
    langBadge.style.display = entry.sprache ? '' : 'none';

    document.getElementById('profile-topics').innerHTML = themeBadgesHtml(cfg, professorThemes(cfg, entry));

    const notePanel = document.getElementById('note-panel');
    document.getElementById('profile-note').textContent = entry.anmerkung || '';
    notePanel.style.display = entry.anmerkung ? '' : 'none';

    const resources = professorResources(entry);
    renderList('videos-panel', 'profile-videos', resources.filter(r => r.kind === 'video'));
    renderList('buecher-panel', 'profile-buecher', resources.filter(r => r.kind === 'buch'));

    show('content');
  }

  async function init() {
    const id = new URLSearchParams(window.location.search).get('id');
    const [data, tagCfg] = await Promise.all([loadData(), loadTagConfig()]);
    cfg = tagCfg;

    if (!id || !data) {
      show('not-found');
      return;
    }

    try {
      // Fallback über den Namen, damit alte Links (z. B. ?id=Hamza%20Yusuf) weiter funktionieren
      const entry = data.find(e => e.id === id) || data.find(e => e.name === id);
      if (!entry) {
        show('not-found');
        return;
      }
      renderProfile(entry);
    } catch (err) {
      console.error('Fehler beim Anzeigen des Profils:', err);
      show('not-found');
    }
  }

  return { init };
})();

/* =========================================================
   THEMEN-ÜBERSICHT (themen.html): nur inhaltliche Themen, gruppiert
   ========================================================= */

const ThemenPage = (() => {
  let cfg = buildTagConfig(null);
  let stats = new Map(); // Label → { videos, buecher, profs:Set }
  const els = {};

  function cacheEls() {
    els.groups = document.getElementById('themen-groups');
    els.search = document.getElementById('themen-search');
    els.count = document.getElementById('themen-count');
  }

  function collectStats(data) {
    const result = new Map();
    allResources(data).forEach(r => {
      new Set(r.themen.filter(t => isThemaTag(cfg, t)).map(t => tagLabel(cfg, t))).forEach(label => {
        if (!result.has(label)) result.set(label, { videos: 0, buecher: 0, profs: new Set() });
        const s = result.get(label);
        if (r.kind === 'buch') s.buecher += 1; else s.videos += 1;
        s.profs.add(r.prof.id);
      });
    });
    return result;
  }

  function statsText(s) {
    const parts = [];
    if (s.videos) parts.push(countLabel(s.videos, 'Video', 'Videos'));
    if (s.buecher) parts.push(countLabel(s.buecher, 'Buch', 'Bücher'));
    if (s.profs.size) parts.push(countLabel(s.profs.size, 'Gelehrter', 'Gelehrte'));
    return parts.join(' · ');
  }

  function tileTemplate(name, beschreibung, s) {
    return `
      <a class="theme-tile" href="${themaUrl(name)}">
        <span class="theme-tile-name">${escapeHtml(name)}</span>
        ${beschreibung ? `<span class="theme-tile-desc">${escapeHtml(beschreibung)}</span>` : ''}
        <span class="theme-tile-meta">${escapeHtml(statsText(s))}</span>
      </a>
    `;
  }

  function render() {
    const terms = searchTerms(els.search.value);
    const matches = (name, desc) =>
      scoreFields([[normalizeText(name), 2], [normalizeText(desc), 1]], terms) > 0;

    // Gruppen aus tags.json; Themen ohne Einträge werden ausgeblendet
    const groups = cfg.gruppen
      .filter(g => g.art === 'thema')
      .map(g => ({ name: g.name, tags: g.tags.map(t => ({ name: t.name, beschreibung: t.beschreibung })) }));

    // In data.json verwendete Themen, die (noch) nicht in tags.json stehen
    const known = new Set(cfg.themaTags);
    const unknown = [...stats.keys()].filter(l => !known.has(l)).sort((a, b) => a.localeCompare(b, 'de'));
    if (unknown.length) groups.push({ name: 'Weitere Themen', tags: unknown.map(n => ({ name: n, beschreibung: '' })) });

    let total = 0;
    const html = groups.map(g => {
      const tiles = g.tags
        .filter(t => stats.has(t.name) && matches(t.name, t.beschreibung))
        .map(t => tileTemplate(t.name, t.beschreibung, stats.get(t.name)));
      total += tiles.length;
      if (!tiles.length) return '';
      return `
        <section class="theme-group">
          <h2 class="section-title">${escapeHtml(g.name)}</h2>
          <div class="themen-cloud">${tiles.join('')}</div>
        </section>`;
    }).join('');

    els.count.textContent = total;
    els.groups.innerHTML = total
      ? html
      : errorStateHtml('Keine Themen gefunden', 'Passe deine Suche an, um andere Themen zu sehen.');
  }

  async function init() {
    cacheEls();
    const [data, tagCfg] = await Promise.all([loadData(), loadTagConfig()]);
    cfg = tagCfg;

    if (data === null) {
      els.groups.innerHTML = errorStateHtml(
        'Daten konnten nicht geladen werden',
        'Bitte prüfe, ob "data.json" erreichbar ist und gültiges JSON enthält.'
      );
      return;
    }

    try {
      stats = collectStats(data);
      render();
      els.search.addEventListener('input', render);
    } catch (err) {
      console.error('Fehler beim Aufbau der Themen-Übersicht:', err);
      els.groups.innerHTML = errorStateHtml(
        'Beim Anzeigen der Themen ist ein Fehler aufgetreten',
        'Prüfe, ob "data.json" und "tags.json" gültiges JSON enthalten. Details stehen in der Browser-Konsole.'
      );
    }
  }

  return { init };
})();

/* =========================================================
   THEMA (thema.html): alle Videos, Bücher und Gelehrten zu einem
   Tag – mit Filtern für Sprache, Format und Niveau
   ========================================================= */

const ThemaPage = (() => {
  let cfg = buildTagConfig(null);
  let matches = [];
  const els = {};

  function cacheEls() {
    [
      ['loading', 'thema-loading-state'], ['notFound', 'thema-not-found-state'], ['empty', 'thema-empty-state'],
      ['content', 'thema-content'], ['eyebrow', 'thema-eyebrow'], ['title', 'thema-title'],
      ['desc', 'thema-desc'], ['summary', 'thema-summary'], ['filters', 'thema-filters'],
      ['lang', 'thema-filter-lang'], ['format', 'thema-filter-format'], ['niveau', 'thema-filter-niveau'],
      ['clear', 'thema-clear'], ['filterEmpty', 'thema-filter-empty'],
      ['profPanel', 'thema-professoren-panel'], ['profList', 'thema-professoren'],
      ['videosPanel', 'thema-videos-panel'], ['videosList', 'thema-videos'],
      ['buecherPanel', 'thema-buecher-panel'], ['buecherList', 'thema-buecher']
    ].forEach(([key, id]) => { els[key] = document.getElementById(id); });
  }

  function show(state) {
    els.loading.style.display = state === 'loading' ? '' : 'none';
    els.notFound.style.display = state === 'not-found' ? '' : 'none';
    els.empty.style.display = state === 'empty' ? '' : 'none';
    els.content.style.display = state === 'content' ? '' : 'none';
  }

  /** Ein Filter wird nur angezeigt, wenn es mindestens zwei Werte zur Auswahl gibt. */
  function setupFilters() {
    const setup = (select, placeholder, options) => {
      fillSelect(select, placeholder, options);
      select.hidden = options.length < 2;
    };
    setup(els.lang, 'Alle Sprachen', languageOptions(cfg, matches));
    setup(els.format, 'Alle Formate', formatOptions(cfg, matches));
    setup(els.niveau, 'Alle Niveaus', groupOptions(cfg, matches, 'niveau'));
    els.filters.hidden = [els.lang, els.format, els.niveau].every(s => s.hidden);
  }

  function currentFilters() {
    const value = s => (s.hidden ? '' : s.value);
    return { sprache: value(els.lang), format: value(els.format), niveau: value(els.niveau) };
  }

  function profCardTemplate(prof) {
    return `
      <a class="theme-prof-card" href="${profileUrl(prof.id)}">
        <span class="theme-prof-name">${escapeHtml(prof.name)}</span>
        ${prof.spezialisierung ? `<span class="theme-prof-spez">${escapeHtml(prof.spezialisierung)}</span>` : ''}
      </a>
    `;
  }

  function renderPanel(panel, list, items, template) {
    panel.style.display = items.length ? '' : 'none';
    list.innerHTML = items.map(template).join('');
  }

  function render() {
    const visible = matches.filter(r => matchesResourceFilters(cfg, r, currentFilters()));
    const videos = visible.filter(r => r.kind === 'video');
    const buecher = visible.filter(r => r.kind === 'buch');
    const profs = sortProfessors([...new Set(visible.map(r => r.prof))]);

    els.summary.textContent = [
      countLabel(videos.length, 'Video', 'Videos'),
      countLabel(buecher.length, 'Buch', 'Bücher'),
      countLabel(profs.length, 'Gelehrter', 'Gelehrte')
    ].join(' · ');

    const item = r => resourceItemHtml(cfg, r, { showProf: true, showLang: 'always' });
    renderPanel(els.profPanel, els.profList, profs, profCardTemplate);
    renderPanel(els.videosPanel, els.videosList, videos, item);
    renderPanel(els.buecherPanel, els.buecherList, buecher, item);
    els.filterEmpty.hidden = visible.length > 0;
  }

  async function init() {
    cacheEls();
    const thema = new URLSearchParams(window.location.search).get('thema');
    const [data, tagCfg] = await Promise.all([loadData(), loadTagConfig()]);
    cfg = tagCfg;

    if (!thema || !data) {
      show('not-found');
      return;
    }

    try {
      const label = tagLabel(cfg, thema.trim());
      const info = tagInfo(cfg, label);
      const needle = label.toLowerCase();
      matches = allResources(sortProfessors(data)).filter(r => r.themen.some(t => t.toLowerCase() === needle));

      document.title = `${label} — Thema — ARCHIV`;
      els.title.textContent = label;
      els.eyebrow.textContent = info ? info.gruppe.name : 'Thema';
      els.desc.textContent = info?.beschreibung || '';
      els.desc.hidden = !info?.beschreibung;

      if (matches.length === 0) {
        show('empty');
        return;
      }

      setupFilters();
      [els.lang, els.format, els.niveau].forEach(s => s.addEventListener('change', render));
      els.clear.addEventListener('click', () => {
        [els.lang, els.format, els.niveau].forEach(s => { s.value = ''; });
        render();
      });
      render();
      show('content');
    } catch (err) {
      console.error('Fehler beim Anzeigen der Themen-Seite:', err);
      show('not-found');
    }
  }

  return { init };
})();

/* =========================================================
   Start je nach Seite
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('card-grid')) IndexPage.init();
  if (document.getElementById('profile-content')) ProfilePage.init();
  if (document.getElementById('themen-groups')) ThemenPage.init();
  if (document.getElementById('thema-content')) ThemaPage.init();
});
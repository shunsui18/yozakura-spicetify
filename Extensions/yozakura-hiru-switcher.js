// ╔══════════════════════════════════════════════════════════════════╗
// ║          Yozakura Switcher — Spicetify Extension                 ║
// ║  Real-time accent switching + Spotify Settings integration       ║
// ╚══════════════════════════════════════════════════════════════════╝
// @name         Yozakura Switcher
// @description  Live accent switcher for the Yozakura Hiru theme
// @version      2.2.0
// @author       shunsui18

(async function yozakuraSwitcher() {

  while (!Spicetify?.showNotification || !Spicetify?.LocalStorage)
    await new Promise(r => setTimeout(r, 100));
  while (!Spicetify?.Platform?.History)
    await new Promise(r => setTimeout(r, 100));

  // ── Palette ──────────────────────────────────────────────────────
  // Ordered by maximum adjacent CIE ΔE — no two similar colours sit next to
  // each other in the swatch grid. Hiru accents are deep, saturated tones
  // designed for a light background.
  const ACCENTS = {
    blush:     { label: 'Blush',     hex: '#a03868', desc: 'deep rose'        },
    starlight: { label: 'Starlight', hex: '#887018', desc: 'deep gold'        },
    iris:      { label: 'Iris',      hex: '#6030a0', desc: 'deep purple'      },
    amber:     { label: 'Amber',     hex: '#985818', desc: 'deep amber'       },
    wisteria:  { label: 'Wisteria',  hex: '#4840b0', desc: 'indigo-purple'    },
    lantern:   { label: 'Lantern',   hex: '#a86018', desc: 'deep orange'      },
    harbour:   { label: 'Harbour',   hex: '#286890', desc: 'deep teal'        },
    moon:      { label: 'Moon',      hex: '#806030', desc: 'warm brown'       },
    ember:     { label: 'Ember',     hex: '#884058', desc: 'deep dusty rose'  },
    moss:      { label: 'Moss',      hex: '#287848', desc: 'deep green'       },
    petal:     { label: 'Petal',     hex: '#8830a0', desc: 'deep lavender'    },
    seafoam:   { label: 'Seafoam',   hex: '#187870', desc: 'deep teal-green'  },
    bloom:     { label: 'Bloom',     hex: '#a02868', desc: 'deep cherry'      },
    sky:       { label: 'Sky',       hex: '#2878a8', desc: 'deep sky blue'    },
    crimson:   { label: 'Crimson',   hex: '#983040', desc: 'deep crimson'     },
    indigo:    { label: 'Indigo',    hex: '#2858b8', desc: 'deep indigo'      },
    // ── Special: all 16 Hiru accents applied simultaneously ──────────
    base: {
      label: 'Base',
      // Two-layer background:
      //   1. Specular radial highlight — reads as a sphere
      //   2. Smooth conic-gradient in OKLCH — Hiru palette in hue order.
      //      Warm tones (Lantern/Amber/Starlight) cluster at low hues;
      //      the gradient skews warm-to-cool-to-vivid accordingly.
      hex:  'radial-gradient(circle at 35% 35%,' +
              'rgba(255,255,255,0.45) 0%,' +
              'rgba(255,255,255,0.12) 40%,' +
              'transparent 65%),' +
            'conic-gradient(in oklch,' +
              '#a86018   0.0deg,'  +  // Lantern   (H=34°)
              '#985818  22.5deg,'  +  // Amber     (H=35°)
              '#887018  45.0deg,'  +  // Starlight (H=46°)
              '#287848  67.5deg,'  +  // Moss      (H=141°)
              '#187870  90.0deg,'  +  // Seafoam   (H=178°)
              '#2878a8 112.5deg,'  +  // Sky       (H=207°)
              '#286890 135.0deg,'  +  // Harbour   (H=205°)
              '#806030 157.5deg,'  +  // Cream/Moon(H=34°)
              '#2858b8 180.0deg,'  +  // Indigo    (H=222°)
              '#4840b0 202.5deg,'  +  // Wisteria  (H=244°)
              '#6030a0 225.0deg,'  +  // Iris      (H=283°)
              '#8830a0 247.5deg,'  +  // Petal     (H=290°)
              '#a03868 270.0deg,'  +  // Blush     (H=331°)
              '#884058 292.5deg,'  +  // Ember     (H=342°)
              '#983040 315.0deg,'  +  // Crimson   (H=348°)
              '#a02868 337.5deg,'  +  // Bloom     (H=328°)
              '#a86018 360.0deg)',    // wrap → Lantern, seamless
      desc: 'full palette',
    },
  };

  // ── Utilities ─────────────────────────────────────────────────────
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }

  function rgbStr(hex) {
    const { r, g, b } = hexToRgb(hex);
    return `${r},${g},${b}`;
  }

  // Relative luminance — decides whether button text should be dark or light
  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const chan = v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
  }

  // Light background for dark Hiru accents, dark text for rare bright accents
  function buttonText(hex) {
    return luminance(hex) > 0.35 ? '#2a1848' : '#f0e8f5';
  }

  // ── State helpers ─────────────────────────────────────────────────
  // Stored as JSON under 'yozakura-state': { key, source, lastScheme }
  //   key        — active accent key
  //   source     — 'cli' | 'ui'  (which method was used last)
  //   lastScheme — Spicetify.Config.color_scheme seen on the previous load,
  //                lowercased. If it changed since last session → CLI wins.
  const STATE_KEY = 'yozakura-state';

  function readState() {
    try {
      const raw = Spicetify.LocalStorage.get(STATE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        // Migrate old shapes (lastCompiledHex / lastCliScheme → lastScheme)
        if (!('lastScheme' in s))
          return { key: s.key, source: s.source ?? 'ui', lastScheme: null };
        return s;
      }
    } catch (_) {}
    // Migrate from legacy flat key
    const legacy = Spicetify.LocalStorage.get('yozakura-accent');
    if (legacy && ACCENTS[legacy]) return { key: legacy, source: 'ui', lastScheme: null };
    return null;
  }

  function saveState(key, source, lastScheme) {
    Spicetify.LocalStorage.set(STATE_KEY,
      JSON.stringify({ key, source, lastScheme: lastScheme ?? null })
    );
  }

  // ── Apply accent via inline style on <html> ───────────────────────
  // Inline style beats Spicetify's compiled stylesheet without !important games
  // source: 'ui' (picker / console API) | 'cli' (resolved on init from color_scheme)
  function applyAccent(key, source = 'ui') {
    const root = document.documentElement;

    // Lift base mode whenever switching back to a single accent
    if (key !== 'base') root.removeAttribute('data-yoza-mode');

    // ── Base mode: all 16 Yoru accents across UI zones ────────────
    // The actual zone colours live in the html[data-yoza-mode="base"] CSS block
    // in user.css.  --spice-button stays Lantern (nav buttons are intentionally
    // Lantern; the hint reads "color_scheme Base").  --accent is decoupled and
    // set to Petal so any element not explicitly covered in the CSS block gets a
    // soft neutral lavender instead of flooding the UI with warm peach.
    if (key === 'base') {
      root.setAttribute('data-yoza-mode', 'base');
      const spiceHex  = '#a86018'; // Lantern  — for --spice-* vars
      const spiceRgb  = '168,96,24';
      const accentHex = '#8830a0'; // Petal    — neutral fallback for var(--accent)
      root.style.setProperty('--spice-button',            spiceHex);
      root.style.setProperty('--spice-button-active',     spiceHex);
      root.style.setProperty('--spice-tab-active',        spiceHex);
      root.style.setProperty('--spice-notification',      spiceHex);
      root.style.setProperty('--spice-rgb-button',        spiceRgb);
      root.style.setProperty('--spice-rgb-tab-active',    spiceRgb);
      root.style.setProperty('--spice-rgb-notification',  spiceRgb);
      root.style.setProperty('--spice-rgb-selected-row',  spiceRgb);
      root.style.setProperty('--accent',                  accentHex);
      root.style.setProperty('--button-text',             '#f0e8f5'); // light on dark Petal
      root.style.setProperty('--accent-filter',           ACCENT_FILTERS.petal);
      saveState('base', source, readState()?.lastScheme ?? null);
      document.querySelectorAll('.yoza-swatch').forEach(el =>
        el.classList.toggle('active', el.dataset.accent === 'base')
      );
      return;
    }

    // ── Single-accent mode (existing logic) ───────────────────────
    const info = ACCENTS[key] ?? ACCENTS.lantern;
    const hex  = info.hex;
    const rgb  = rgbStr(hex);
    const bt   = buttonText(hex);

    const vars = {
      '--spice-button':            hex,
      '--spice-button-active':     hex,
      '--spice-tab-active':        hex,
      '--spice-notification':      hex,
      '--spice-rgb-button':        rgb,
      '--spice-rgb-tab-active':    rgb,
      '--spice-rgb-notification':  rgb,
      '--spice-rgb-selected-row':  rgb,
      // user.css reads these two custom props
      '--accent':                  `var(--spice-button)`,
      '--button-text':             bt,
      '--accent-filter':           accentFilter(hex, key),
    };

    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);

    saveState(key, source, readState()?.lastScheme ?? null);
    document.querySelectorAll('.yoza-swatch').forEach(el =>
      el.classList.toggle('active', el.dataset.accent === key)
    );
  }

  // ╔══════════════════════════════════════════════════════════════════╗
  // ║  ACCENT FILTERS — edit these to taste                           ║
  // ║                                                                 ║
  // ║  Each value becomes the CSS `filter:` applied to SVG elements   ║
  // ║  (equaliser bars, icons, etc.) via --accent-filter in user.css. ║
  // ║                                                                 ║
  // ║  Handy tool to generate filters from a target hex colour:       ║
  // ║  https://codepen.io/sosuke/pen/Pjoqqp                           ║
  // ║                                                                 ║
  // ║  Leave a value as null to fall back to the auto-computed        ║
  // ║  filter for that accent.                                        ║
  // ╚══════════════════════════════════════════════════════════════════╝
  const ACCENT_FILTERS = {
    lantern:   'brightness(0) invert(40%) sepia(80%) saturate(800%) hue-rotate(1deg) brightness(90%) contrast(90%)',
    blush:     'brightness(0) invert(32%) sepia(65%) saturate(700%) hue-rotate(298deg) brightness(88%) contrast(90%)',
    petal:     'brightness(0) invert(25%) sepia(80%) saturate(800%) hue-rotate(256deg) brightness(85%) contrast(95%)',
    iris:      'brightness(0) invert(22%) sepia(75%) saturate(700%) hue-rotate(249deg) brightness(80%) contrast(95%)',
    wisteria:  'brightness(0) invert(25%) sepia(80%) saturate(700%) hue-rotate(210deg) brightness(80%) contrast(95%)',
    indigo:    'brightness(0) invert(30%) sepia(75%) saturate(700%) hue-rotate(188deg) brightness(80%) contrast(92%)',
    harbour:   'brightness(0) invert(32%) sepia(60%) saturate(600%) hue-rotate(170deg) brightness(78%) contrast(90%)',
    sky:       'brightness(0) invert(32%) sepia(65%) saturate(650%) hue-rotate(173deg) brightness(80%) contrast(90%)',
    seafoam:   'brightness(0) invert(30%) sepia(55%) saturate(700%) hue-rotate(144deg) brightness(75%) contrast(90%)',
    moss:      'brightness(0) invert(28%) sepia(60%) saturate(600%) hue-rotate(107deg) brightness(78%) contrast(90%)',
    starlight: 'brightness(0) invert(38%) sepia(90%) saturate(900%) hue-rotate(13deg) brightness(88%) contrast(88%)',
    amber:     'brightness(0) invert(38%) sepia(85%) saturate(850%) hue-rotate(2deg) brightness(88%) contrast(88%)',
    ember:     'brightness(0) invert(28%) sepia(60%) saturate(600%) hue-rotate(308deg) brightness(82%) contrast(90%)',
    crimson:   'brightness(0) invert(28%) sepia(65%) saturate(650%) hue-rotate(314deg) brightness(80%) contrast(92%)',
    bloom:     'brightness(0) invert(28%) sepia(70%) saturate(700%) hue-rotate(294deg) brightness(85%) contrast(90%)',
    moon:      'brightness(0) invert(35%) sepia(75%) saturate(600%) hue-rotate(1deg) brightness(85%) contrast(88%)',
  };

  // Returns the hand-edited filter for `hex`, or auto-computes one as fallback.
  function accentFilter(hex, key) {
    if (key && ACCENT_FILTERS[key] != null) return ACCENT_FILTERS[key];
    // Auto-compute fallback (used when a filter is set to null)
    const { r, g, b } = hexToRgb(hex);
    const h = Math.round(Math.atan2(
      Math.sqrt(3) * (g - b),
      2 * r - g - b
    ) * 180 / Math.PI);
    const sat = Math.round(100 * Math.max(r, g, b) / 255);
    return `brightness(0) invert(85%) sepia(20%) saturate(${sat}%) hue-rotate(${h}deg) brightness(100%) contrast(90%)`;
  }

  // Returns a small inline badge showing which method set the accent last.
  // Rendered inside the hint bar in both the panel and the popup.
  function sourceBadge(source) {
    const label = source === 'cli' ? 'via CLI' : 'via picker';
    const col   = source === 'cli' ? 'rgba(40,104,144,0.18)' : 'rgba(136,48,160,0.15)';
    return `<span style="margin-left:8px;padding:1px 6px;border-radius:4px;` +
           `background:${col};font-size:10px;color:rgba(0,0,0,0.55);` +
           `font-weight:600;letter-spacing:0.03em;vertical-align:middle">${label}</span>`;
  }

  // ── Panel styles (injected once into <head>) ──────────────────────
  function injectPanelStyles() {
    if (document.getElementById('yoza-styles')) return;
    const s = document.createElement('style');
    s.id = 'yoza-styles';
    s.textContent = `
      #yoza-panel {
        padding: 20px 0 32px;
        border-bottom: 1px solid rgba(0,0,0,0.10);
        margin-bottom: 0;
      }
      #yoza-panel .yoza-heading {
        font-size: 24px;
        font-weight: 700;
        color: #2a1848;
        margin: 0 0 2px;
        letter-spacing: -0.02em;
      }
      #yoza-panel .yoza-sub {
        font-size: 13px;
        color: rgba(0,0,0,0.45);
        margin: 0 0 20px;
      }
      .yoza-grid {
        display: grid;
        grid-template-columns: repeat(8, 1fr);
        gap: 6px;
      }
      .yoza-swatch {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 10px 4px 8px;
        border-radius: 10px;
        border: 1.5px solid transparent;
        cursor: pointer;
        user-select: none;
        transition: background 140ms ease, border-color 140ms ease, transform 130ms ease;
      }
      .yoza-swatch:hover {
        background: rgba(0,0,0,0.05);
        transform: translateY(-1px);
      }
      .yoza-swatch.active {
        background: rgba(0,0,0,0.07);
        border-color: rgba(0,0,0,0.20);
      }
      .yoza-dot {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.22);
        position: relative;
        transition: transform 140ms ease, box-shadow 140ms ease;
        flex-shrink: 0;
      }
      .yoza-swatch:hover .yoza-dot { transform: scale(1.07); box-shadow: 0 4px 14px rgba(0,0,0,0.32); }
      .yoza-swatch.active .yoza-dot::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 50%;
        background: rgba(0,0,0,0.18);
      }
      .yoza-swatch.active .yoza-dot::before {
        content: '✓';
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        font-weight: 700;
        color: rgba(255,255,255,0.92);
        z-index: 1;
        text-shadow: 0 1px 4px rgba(0,0,0,0.6);
      }
      .yoza-label {
        font-size: 10px;
        color: rgba(0,0,0,0.40);
        text-align: center;
        font-weight: 500;
        letter-spacing: 0.01em;
        line-height: 1;
        transition: color 140ms ease;
      }
      .yoza-swatch:hover .yoza-label,
      .yoza-swatch.active .yoza-label { color: rgba(0,0,0,0.72); }
      .yoza-hint {
        margin-top: 16px;
        padding: 9px 13px;
        background: rgba(0,0,0,0.05);
        border-radius: 7px;
        border-left: 2px solid rgba(0,0,0,0.12);
        font-size: 11px;
        color: rgba(0,0,0,0.50);
        font-family: 'ComicShannsMono Nerd Font', 'JetBrains Mono', ui-monospace, monospace;
        line-height: 1.6;
      }
      .yoza-hint b { color: rgba(0,0,0,0.65); }
      .yoza-hint em { font-style: normal; color: var(--spice-button, #a86018); }

      /* Base swatch spans the full grid width as a featured row */
      .yoza-swatch[data-accent="base"] {
        grid-column: 1 / -1;
        flex-direction: row;
        justify-content: center;
        gap: 10px;
        border-top: 1px solid rgba(0,0,0,0.08);
        padding-top: 14px;
        margin-top: 4px;
      }
      .yoza-swatch[data-accent="base"] .yoza-label {
        font-size: 11px;
        align-self: center;
      }
    `;
    document.head.appendChild(s);
  }

  // ── Swatch grid HTML ──────────────────────────────────────────────
  function swatchGrid(currentKey, idPrefix) {
    return `<div class="yoza-grid" id="${idPrefix}-swatches">
      ${Object.entries(ACCENTS).map(([key, info]) => `
        <div class="yoza-swatch${key === currentKey ? ' active' : ''}" data-accent="${key}" title="${info.label} · ${info.desc}">
          <div class="yoza-dot" style="background:${info.hex}"></div>
          <span class="yoza-label">${info.label}</span>
        </div>`).join('')}
    </div>`;
  }

  // ── Settings page panel ───────────────────────────────────────────
  function injectPanel() {
    try {
      if (document.getElementById('yoza-panel')) {
        console.log('[Yozakura] panel already exists, skipping');
        return;
      }
      const target = document.querySelector('.x-settings-container');
      if (!target) {
        console.log('[Yozakura] .x-settings-container not found');
        return;
      }

      console.log('[Yozakura] injecting panel into', target);
      injectPanelStyles();
      const key    = readState()?.key ?? 'blush';
      const source = readState()?.source ?? 'ui';

      const panel = document.createElement('div');
      panel.id = 'yoza-panel';
      panel.innerHTML = `
        <p class="yoza-heading">🌸 Yozakura</p>
        <p class="yoza-sub">Choose an accent — applied instantly</p>
        ${swatchGrid(key, 'pref')}
        <div class="yoza-hint">
          <b>spicetify config color_scheme</b> <em>${ACCENTS[key]?.label ?? key}</em> &amp;&amp; spicetify apply${sourceBadge(source)}
        </div>`;

      target.prepend(panel);
      console.log('[Yozakura] panel injected OK');

      document.getElementById('pref-swatches')?.addEventListener('click', e => {
        const sw = e.target.closest('.yoza-swatch[data-accent]');
        if (!sw) return;
        applyAccent(sw.dataset.accent, 'ui');
        Spicetify.showNotification(`🌸 ${ACCENTS[sw.dataset.accent].label}`);
        panel.querySelector('em').textContent = ACCENTS[sw.dataset.accent].label;
        // Replace the badge to reflect 'ui' source
        const hint = panel.querySelector('.yoza-hint');
        const badge = hint.querySelector('span');
        if (badge) badge.outerHTML = sourceBadge('ui');
        else hint.insertAdjacentHTML('beforeend', sourceBadge('ui'));
      });
    } catch (err) {
      console.error('[Yozakura] injectPanel error:', err);
    }
  }

  function removePanel() {
    document.getElementById('yoza-panel')?.remove();
  }

  // ── Quick-pick popup ──────────────────────────────────────────────
  function openPicker() {
    injectPanelStyles();
    const state  = readState();
    const key    = state?.key    ?? 'blush';
    const source = state?.source ?? 'ui';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding: 4px 4px 16px;min-width:520px;';
    wrap.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:10px;padding:16px 16px 0">
        <span style="font-size:20px;font-weight:700;color:#2a1848;letter-spacing:-0.01em">🌸 Yozakura</span>
        <span style="font-size:12px;color:rgba(0,0,0,0.45);margin-left:auto">Hiru palette</span>
      </div>
      <p style="font-size:12px;color:rgba(0,0,0,0.45);margin:2px 0 14px;padding:0 16px">
        Select an accent — applied in real time
      </p>
      <div style="padding:0 8px">${swatchGrid(key, 'popup')}</div>
      <div class="yoza-hint" style="margin:14px 16px 0" id="popup-hint">
        <b>spicetify config color_scheme</b> <em>${ACCENTS[key]?.label ?? key}</em> &amp;&amp; spicetify apply${sourceBadge(source)}
      </div>`;

    Spicetify.PopupModal.display({ title: '', content: wrap, isLarge: false });

    document.getElementById('popup-swatches')?.addEventListener('click', e => {
      const sw = e.target.closest('.yoza-swatch[data-accent]');
      if (!sw) return;
      const k = sw.dataset.accent;
      applyAccent(k, 'ui');
      Spicetify.showNotification(`🌸 ${ACCENTS[k].label}`);
      document.querySelector('#popup-hint em').textContent = ACCENTS[k].label;
      // Replace the badge to reflect 'ui' source
      const hint  = document.getElementById('popup-hint');
      const badge = hint?.querySelector('span');
      if (badge) badge.outerHTML = sourceBadge('ui');
      else hint?.insertAdjacentHTML('beforeend', sourceBadge('ui'));
    });
  }

  // ── Topbar button ─────────────────────────────────────────────────
  function addTopbarButton() {
    try {
      new Spicetify.Topbar.Button('Yozakura', 'podcasts', openPicker, false, true);
    } catch (_) {
      const topbar = document.querySelector('.main-topBar-container');
      if (!topbar) return;
      const btn = Object.assign(document.createElement('button'), {
        id: 'yoza-topbar-btn', title: 'Yozakura · accent picker', textContent: '🌸',
      });
      btn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:18px;' +
        'line-height:1;padding:6px 8px;border-radius:50%;color:rgba(0,0,0,0.4);' +
        'transition:color 150ms,background 150ms;';
      btn.addEventListener('mouseenter', () => { btn.style.background='rgba(0,0,0,0.06)'; btn.style.color='#2a1848'; });
      btn.addEventListener('mouseleave', () => { btn.style.background='none'; btn.style.color='rgba(0,0,0,0.4)'; });
      btn.addEventListener('click', openPicker);
      const anchor = topbar.querySelector('[data-testid="user-widget-link"],.main-topBar-button');
      anchor ? topbar.insertBefore(btn, anchor) : topbar.appendChild(btn);
    }
  }

  // ── Preferences watcher ───────────────────────────────────────────
  function watchPreferences() {
    Spicetify.Platform.History.listen(({ pathname }) => {
      if (pathname === '/preferences') {
        [300, 600, 1000, 1800].forEach(ms => setTimeout(injectPanel, ms));
      } else {
        removePanel();
      }
    });

    // MutationObserver: inject whenever .x-settings-container appears without our panel
    new MutationObserver(() => {
      if (document.querySelector('.x-settings-container') &&
          !document.getElementById('yoza-panel'))
        injectPanel();
    }).observe(document.body, { childList: true, subtree: true });

    // Already on settings at load time
    [300, 600, 1000, 1800].forEach(ms => setTimeout(injectPanel, ms));
  }

  // ── Keyboard shortcut Alt+Y ───────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      openPicker();
    }
  });

  // ── Console API ───────────────────────────────────────────────────
  window.Yozakura = {
    set(key) {
      if (!ACCENTS[key]) { console.warn('[Yozakura] Unknown accent:', key); return; }
      const source = readState()?.source ?? 'ui';
      applyAccent(key, source);
      Spicetify.showNotification(`🌸 Yozakura › ${ACCENTS[key].label}`);
    },
    cycle() {
      const keys   = Object.keys(ACCENTS);
      const state  = readState();
      const cur    = state?.key ?? 'blush';
      const source = state?.source ?? 'ui';   // preserve whichever method was used last
      const next   = keys[(keys.indexOf(cur) + 1) % keys.length];
      applyAccent(next, source);
      Spicetify.showNotification(`🌸 Yozakura › ${ACCENTS[next].label}`);
    },
    list() {
      console.table(Object.fromEntries(
        Object.entries(ACCENTS).map(([k, v]) => [k, { colour: v.hex, desc: v.desc }])
      ));
    },
    current() { const s = readState(); return s ? `${s.key} (${s.source})` : 'blush'; },
    inject() { injectPanel(); },
    remove() { removePanel(); },
  };

  // ── Init ──────────────────────────────────────────────────────────

  // Compares Spicetify.Config.color_scheme against the value stored from the
  // previous session (lastScheme). This is the authoritative signal for whether
  // the user ran `spicetify config color_scheme <X> && spicetify apply` between
  // sessions — i.e. whether the CLI was the last method used.
  //
  // Decision table:
  //   lastScheme === null (first run / migrating)
  //     → treat current Config value as CLI, store it, apply it.
  //   currentScheme !== lastScheme
  //     → Config changed between sessions → spicetify apply was run → CLI wins.
  //   currentScheme === lastScheme && state.source === 'cli'
  //     → No CLI change, last method was CLI → keep CLI key & source.
  //   currentScheme === lastScheme && state.source === 'ui'
  //     → No CLI change, last method was the picker → keep UI key & source.
  function resolveInitialAccent() {
    const state         = readState();
    const currentScheme = (Spicetify.Config?.color_scheme ?? '').toLowerCase();
    const lastScheme    = (state?.lastScheme ?? '').toLowerCase();

    console.log('[Yozakura] Config.color_scheme:', currentScheme);
    console.log('[Yozakura] lastScheme in state:', lastScheme);
    console.log('[Yozakura] stored state:', state);

    // Map the current Config scheme to an accent key.
    // 'base' stays 'base'; everything else is lowercased and looked up in ACCENTS.
    const schemeKey = currentScheme && ACCENTS[currentScheme] ? currentScheme : null;

    // ── First run or migrating from old state shape ───────────────
    if (state === null || lastScheme === '') {
      const key = schemeKey ?? 'blush';
      console.log('[Yozakura] first run → cli: ' + key);
      return { key, source: 'cli', lastScheme: currentScheme };
    }

    // ── Config changed between sessions → CLI was used ────────────
    if (currentScheme !== lastScheme) {
      const key = schemeKey ?? state.key ?? 'blush';
      console.log('[Yozakura] scheme changed (' + lastScheme + ' → ' + currentScheme + ') → CLI wins: ' + key);
      return { key, source: 'cli', lastScheme: currentScheme };
    }

    // ── Config unchanged → honour stored source & key ─────────────
    console.log('[Yozakura] scheme unchanged → honouring stored source: ' + state.source + ' / key: ' + state.key);
    return { key: state.key, source: state.source, lastScheme: currentScheme };
  }

  const resolved = resolveInitialAccent();
  saveState(resolved.key, resolved.source, resolved.lastScheme);
  applyAccent(resolved.key, resolved.source);
  addTopbarButton();
  watchPreferences();

  console.log('%c🌸 Yozakura%c v2.0 — %c' + resolved.key + ' %c(' + resolved.source + ')',
    'color:#a86018;font-weight:700;font-size:13px',
    'color:rgba(0,0,0,0.4)',
    'color:#2a1848;font-weight:600',
    'color:rgba(0,0,0,0.3);font-size:11px'
  );
  console.log('%c  Alt+Y · 🌸 topbar · Yozakura.list() · Yozakura.cycle()',
    'color:rgba(0,0,0,0.25);font-size:11px');

})();
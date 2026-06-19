/**
 * ui/operator.js — Redesigned operator panel.
 * Dashboard (card grid) → Detail (per-category controls) → Sub-dialogs (text editor, photo picker).
 */

import { exitFullscreen, log, requestFullscreen } from '../services/platform.js';
import { CUSTOM_TEXT_DEFAULTS, THEME_PRESETS, THEME_PRESET_KEYS, get as getCurrentSettings } from '../services/settings.js';

// ─── Constants ────────────────────────────────────────────────────────────

const TAP_ZONE_ID = 'op-tap-zone';
const PANEL_ID = 'operator-panel';
const EDITOR_PANEL_ID = 'text-editor-panel';
const TAP_COUNT_REQUIRED = 5;
const TAP_WINDOW_MS = 3000;
const DEBOUNCE_MS = 150;

// ─── Custom text metadata ─────────────────────────────────────────────────

const CUSTOM_TEXT_LABELS = {
  focusMenujuAdzan: 'Label "Menuju Adzan"',
  focusMenujuAzanJumat: 'Label "Menuju Azan Jumat"',
  focusWaktuAdzan: 'Label "Waktu Adzan"',
  focusWaktuAzanJumat: 'Label "Waktu Azan Jumat"',
  focusIqomah: 'Label "Iqomah"',
  focusPukul: 'Label "Pukul"',
  focusJedaQabliyah: 'Label "Jeda Shalat Qabliyah"',
  focusAzanKhutbah: 'Label "Azan Khutbah"',
  focusWaktuAzanKhutbah: 'Label "Waktu Azan Khutbah"',
  focusIqomahJumat: 'Label "Iqomah Jumat"',
  focusAzanKhutbahName: 'Label "Azan Khutbah" (nama)',
  prayerLabelImsak: 'Label Imsak',
  prayerLabelSubuh: 'Label Subuh',
  prayerLabelSyuruq: 'Label Syuruq',
  prayerLabelDzuhur: 'Label Zuhur',
  prayerLabelJumat: 'Label Jumat',
  prayerLabelAshar: 'Label Ashar',
  prayerLabelMaghrib: 'Label Magrib',
  prayerLabelIsya: 'Label Isya',
  heroIqomahPrefix: 'Prefix "Iqomah" di Badge',
  simBannerLabel: 'Label "MODE SIMULASI"',
};

const CUSTOM_TEXT_GROUPS = [
  {
    label: 'Overlay Fokus',
    keys: [
      'focusMenujuAdzan', 'focusMenujuAzanJumat', 'focusWaktuAdzan',
      'focusWaktuAzanJumat', 'focusIqomah', 'focusPukul',
      'focusJedaQabliyah', 'focusAzanKhutbah', 'focusWaktuAzanKhutbah',
      'focusIqomahJumat', 'focusAzanKhutbahName',
    ],
  },
  {
    label: 'Label Sholat',
    keys: [
      'prayerLabelImsak', 'prayerLabelSubuh', 'prayerLabelSyuruq',
      'prayerLabelDzuhur', 'prayerLabelJumat', 'prayerLabelAshar',
      'prayerLabelMaghrib', 'prayerLabelIsya',
    ],
  },
  {
    label: 'Lainnya',
    keys: ['heroIqomahPrefix', 'simBannerLabel'],
  },
];

const CUSTOM_TEXT_ORDER = CUSTOM_TEXT_GROUPS.flatMap(g => g.keys);

// ─── Category definitions ─────────────────────────────────────────────────

const CATEGORIES = {
  identitas: {
    label: 'Identitas & Logo',
    icon: 'ic-masjid',
  },
  tema: {
    label: 'Tema & Warna',
    icon: 'ic-theme',
  },
  slideshow: {
    label: 'Slideshow',
    icon: 'ic-slideshow',
  },
  teks: {
    label: 'Teks & Pesan',
    icon: 'ic-text',
  },
  jadwal: {
    label: 'Jadwal Sholat',
    icon: 'ic-clock',
  },
  jumat: {
    label: 'Jumat',
    icon: 'ic-minbar',
  },
  simulasi: {
    label: 'Mode Lanjutan',
    icon: 'ic-settings',
  },
};

// ─── State ────────────────────────────────────────────────────────────────

let _tapCount = 0;
let _tapTimer = null;
let _callbacks = {};
let _isFullscreen = false;
let _editorBound = false;
let _editorResolver = null;
let _activeView = 'dashboard'; // 'dashboard' | category key
let _customTextSettings = null;
let _khutbahSelectedFile = null;
let _khutbahImages = [];
let _debounceTimers = {};
let _toastTimer = null;
let _editingKey = null;

// ─── Init ─────────────────────────────────────────────────────────────────

export function init(callbacks) {
  _callbacks = callbacks ?? {};
  _bindTapZone();
  _bindPanelButtons();
  _bindTextEditor();
  _bindCustomTextPanel();
  _bindKhutbahPhotoPanel();

  window.__dev = window.__dev ?? {};
  window.__dev.openOperator = open;
}

// ─── Open / Close ─────────────────────────────────────────────────────────

export function open() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;
  _showDashboard();
  _syncFullscreenButton();
  panel.hidden = false;
  panel.focus();
}

export function close() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.hidden = true;
  _showDashboard();
  _hideAllSubPanels();
}

// ─── Navigation ───────────────────────────────────────────────────────────

function _showDashboard() {
  _activeView = 'dashboard';
  const dashboard = document.getElementById('op-dashboard');
  const detail = document.getElementById('op-detail');
  const title = document.getElementById('op-title');
  if (dashboard) dashboard.hidden = false;
  if (detail) detail.hidden = true;
  if (title) title.textContent = 'Panel Operator';
}

function _openCategory(key) {
  const cat = CATEGORIES[key];
  if (!cat) return;
  _activeView = key;

  const dashboard = document.getElementById('op-dashboard');
  const detail = document.getElementById('op-detail');
  const title = document.getElementById('op-title');
  const detailTitle = document.getElementById('op-detail-title');
  const controls = document.getElementById('op-detail-controls');
  const preview = document.getElementById('op-preview');

  if (dashboard) dashboard.hidden = true;
  if (detail) detail.hidden = false;
  if (title) title.textContent = 'Panel Operator';
  if (detailTitle) detailTitle.textContent = cat.label;

  if (controls) {
    controls.innerHTML = '';
    _renderCategoryControls(key, controls);
  }
  if (preview) {
    preview.innerHTML = '';
    _renderPreview(key, preview);
  }
}

function _renderCategoryControls(key, container) {
  switch (key) {
    case 'identitas': _renderIdentitas(container); break;
    case 'tema': _renderTema(container); break;
    case 'slideshow': _renderSlideshow(container); break;
    case 'teks': _renderTeks(container); break;
    case 'jadwal': _renderJadwal(container); break;
    case 'jumat': _renderJumat(container); break;
    case 'simulasi': _renderSimulasi(container); break;
  }
}

function _renderPreview(key, container) {
  // Mini preview that reacts to CSS variable changes
  const el = document.createElement('div');
  el.className = 'op-preview-inner';
  el.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;align-items:center;';
  el.innerHTML = `
    <div style="font-size:0.7rem;color:var(--color-text-soft);text-align:center;margin-bottom:0.25rem;">Preview</div>
    <div id="op-preview-card" style="width:100%;padding:0.6rem;border-radius:0.6rem;background:var(--accent-current-bg,rgba(220,145,82,0.2));text-align:center;">
      <div id="op-preview-label" style="font-size:0.75rem;font-weight:700;color:var(--color-text);">Subuh</div>
      <div id="op-preview-time" style="font-size:1.1rem;font-weight:800;color:var(--color-text);font-family:var(--font-figure);">04:30</div>
    </div>
    <div id="op-preview-ticker" style="font-size:0.65rem;color:var(--color-text-soft);white-space:nowrap;overflow:hidden;width:100%;text-align:center;">Running text preview...</div>
    <div id="op-preview-countdown" style="font-size:0.85rem;font-weight:700;color:var(--op-accent);">05:00</div>
  `;
  container.appendChild(el);
}

// ─── Category: Identitas ──────────────────────────────────────────────────

function _renderIdentitas(container) {
  const cfg = _getSettings();
  const section = _createSection('Identitas Masjid', 'ic-masjid');

  // Logo preview + change button
  const logoRow = document.createElement('div');
  logoRow.className = 'op-field-row';
  logoRow.style.gridTemplateColumns = '5rem 1fr';
  logoRow.innerHTML = `
    <span class="op-field-row-label">Logo</span>
    <div style="display:flex;align-items:center;gap:0.75rem;">
      <img id="op-logo-preview" src="${cfg.logoPath || 'assets/fallback/logo-masjid.png'}" alt="Logo" style="width:3rem;height:3rem;object-fit:contain;border-radius:0.4rem;background:rgba(255,255,255,0.05);">
      <button id="op-btn-change-logo" class="op-btn" type="button">Ganti Logo</button>
    </div>
  `;
  section.body.appendChild(logoRow);

  // Nama masjid
  const nameRow = document.createElement('div');
  nameRow.className = 'op-field-row';
  nameRow.innerHTML = `
    <label class="op-field-row-label" for="op-field-nama">Nama</label>
    <input id="op-field-nama" class="op-field" type="text" value="${_escHtml(cfg.masjidName || '')}" placeholder="Masjid An-Nur">
  `;
  section.body.appendChild(nameRow);

  // Alamat
  const addrRow = document.createElement('div');
  addrRow.className = 'op-field-row';
  addrRow.innerHTML = `
    <label class="op-field-row-label" for="op-field-alamat">Alamat</label>
    <textarea id="op-field-alamat" class="op-field" rows="2" placeholder="Jl. Contoh No. 1">${_escHtml(cfg.masjidAddress || '')}</textarea>
  `;
  section.body.appendChild(addrRow);

  // Save button
  const btnRow = document.createElement('div');
  btnRow.className = 'op-btn-row';
  btnRow.style.marginTop = '0.5rem';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'op-btn op-btn-primary';
  saveBtn.type = 'button';
  saveBtn.innerHTML = '<svg class="op-icon"><use href="#ic-check"/></svg> Simpan Identitas';
  saveBtn.addEventListener('click', async () => {
    const name = document.getElementById('op-field-nama').value.trim();
    const addr = document.getElementById('op-field-alamat').value.trim();
    if (!name) { _showToast('Nama masjid tidak boleh kosong'); return; }
    close();
    const { save, get } = await import('../services/settings.js');
    await save({ masjidName: name, masjidAddress: addr });
    _callbacks.onSettingsChanged?.(await get());
    _showToast('Identitas masjid disimpan');
  });
  btnRow.appendChild(saveBtn);
  section.body.appendChild(btnRow);

  // Logo change button handler
  setTimeout(() => {
    document.getElementById('op-btn-change-logo')?.addEventListener('click', async () => {
      close();
      await _callbacks.onChangeLogo?.().catch(_logErr);
    });
  }, 0);

  container.appendChild(section.el);
}

// ─── Category: Tema ───────────────────────────────────────────────────────

function _renderTema(container) {
  const cfg = _getSettings();

  // Preset Tema
  const section1 = _createSection('Preset Tema', 'ic-theme');
  const swatchRow = document.createElement('div');
  swatchRow.className = 'op-swatch-row';

  const presetColors = {
    navy: { bg: '#031230', primary: '#002263', accent: '#f0a23b' },
    hijau: { bg: '#041a0e', primary: '#0a4d2e', accent: '#1ea36b' },
    gelap: { bg: '#0d0d1a', primary: '#1a1a2e', accent: '#6b6bd7' },
  };

  for (const key of THEME_PRESET_KEYS) {
    const colors = presetColors[key] || presetColors.navy;
    const swatch = document.createElement('button');
    swatch.className = 'op-swatch' + (cfg.themePreset === key ? ' is-active' : '');
    swatch.type = 'button';
    swatch.title = key;
    swatch.style.background = `linear-gradient(135deg, ${colors.bg} 0%, ${colors.primary} 100%)`;
    swatch.style.borderColor = cfg.themePreset === key ? 'var(--op-accent)' : 'var(--op-card-border)';
    swatch.addEventListener('click', async () => {
      const { save, get } = await import('../services/settings.js');
      const cfg = get();
      const nextSettings = await save({ themePreset: key, themeOverride: {} });
      _callbacks.onSettingsChanged?.(await get());
      _showToast(`Tema: ${key}`);
    });
    swatchRow.appendChild(swatch);
  }
  section1.body.appendChild(swatchRow);
  container.appendChild(section1.el);

  // Warna Aksen (hex)
  const section2 = _createSection('Warna Aksen', null);
  const accentRow = document.createElement('div');
  accentRow.className = 'op-field-row';
  accentRow.innerHTML = `
    <label class="op-field-row-label" for="op-field-accent">Aksen (hex)</label>
    <input id="op-field-accent" class="op-field" type="text" placeholder="#ff8800" value="${(cfg.themeOverride && cfg.themeOverride['--color-primary']) || ''}">
  `;
  section2.body.appendChild(accentRow);
  const accentBtnRow = document.createElement('div');
  accentBtnRow.className = 'op-btn-row';
  const accentSaveBtn = document.createElement('button');
  accentSaveBtn.className = 'op-btn op-btn-primary';
  accentSaveBtn.type = 'button';
  accentSaveBtn.textContent = 'Simpan Warna Aksen';
  accentSaveBtn.addEventListener('click', async () => {
    const hex = document.getElementById('op-field-accent').value.trim();
    if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
      _showToast('Format hex tidak valid');
      return;
    }
    const { save, get } = await import('../services/settings.js');
    const cfg = get();
    const override = { '--color-primary': hex };
    const nextSettings = await save({ themeOverride: override });
    _callbacks.onSettingsChanged?.(await get());
    _showToast('Warna aksen disimpan');
  });
  accentBtnRow.appendChild(accentSaveBtn);
  section2.body.appendChild(accentBtnRow);
  container.appendChild(section2.el);

  // Ukuran Teks
  const section3 = _createSection('Ukuran Teks', null);
  const scaleRow = document.createElement('div');
  scaleRow.className = 'op-slider-row';
  const currentScale = cfg.textScale || 1.0;
  scaleRow.innerHTML = `
    <span class="op-field-row-label">Skala</span>
    <input id="op-slider-textscale" class="op-slider" type="range" min="0.7" max="1.4" step="0.05" value="${currentScale}">
    <span class="op-slider-value" id="op-slider-textscale-val">${currentScale.toFixed(2)}x</span>
  `;
  section3.body.appendChild(scaleRow);
  container.appendChild(section3.el);

  setTimeout(() => {
    const slider = document.getElementById('op-slider-textscale');
    const val = document.getElementById('op-slider-textscale-val');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        if (val) val.textContent = v.toFixed(2) + 'x';
        document.documentElement.style.setProperty('--text-scale', String(v));
        _debounce('textScale', async () => {
          const { save } = await import('../services/settings.js');
          const nextSettings = await save({ textScale: v });
          _callbacks.onSettingsChanged?.(nextSettings);
        });
      });
    }
  }, 0);

  // Transparansi Strip
  const section4 = _createSection('Transparansi Strip', null);
  const opacityRow = document.createElement('div');
  opacityRow.className = 'op-slider-row';
  const currentOpacity = cfg.stripBackgroundOpacity ?? 0.35;
  opacityRow.innerHTML = `
    <span class="op-field-row-label">Opacity</span>
    <input id="op-slider-opacity" class="op-slider" type="range" min="0" max="1" step="0.05" value="${currentOpacity}">
    <span class="op-slider-value" id="op-slider-opacity-val">${currentOpacity.toFixed(2)}</span>
  `;
  section4.body.appendChild(opacityRow);
  container.appendChild(section4.el);

  setTimeout(() => {
    const slider = document.getElementById('op-slider-opacity');
    const val = document.getElementById('op-slider-opacity-val');
    if (slider) {
      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        if (val) val.textContent = v.toFixed(2);
        _applyStripOpacity(v);
        _debounce('stripOpacity', async () => {
          const { save } = await import('../services/settings.js');
          const nextSettings = await save({ stripBackgroundOpacity: v });
          _callbacks.onSettingsChanged?.(nextSettings);
        });
      });
    }
  }, 0);
}

// ─── Category: Slideshow ──────────────────────────────────────────────────

function _renderSlideshow(container) {
  const section = _createSection('Slideshow', 'ic-slideshow');

  // Upload button
  const uploadRow = document.createElement('div');
  uploadRow.className = 'op-btn-row';
  const uploadBtn = document.createElement('button');
  uploadBtn.className = 'op-btn op-btn-primary';
  uploadBtn.type = 'button';
  uploadBtn.innerHTML = '<svg class="op-icon"><use href="#ic-upload"/>svg> Upload Foto';
  uploadBtn.addEventListener('click', async () => {
    close();
    await _callbacks.onAddSlideshowPhotos?.().catch(_logErr);
  });
  uploadRow.appendChild(uploadBtn);
  section.body.appendChild(uploadRow);

  // Fit toggle
  const cfg = _getSettings();
  const fitRow = document.createElement('div');
  fitRow.className = 'op-toggle-row';
  const isCover = (cfg.slideshowFit || 'cover') === 'cover';
  fitRow.innerHTML = `
    <span class="op-toggle-label">Mode: <span id="op-fit-label">${isCover ? 'Cover (crop)' : 'Contain (penuh)'}</span></span>
    <button id="op-toggle-fit" class="op-toggle ${isCover ? 'is-on' : ''}" type="button" aria-pressed="${isCover}"></button>
  `;
  section.body.appendChild(fitRow);

  setTimeout(() => {
    const toggle = document.getElementById('op-toggle-fit');
    const label = document.getElementById('op-fit-label');
    if (toggle) {
      toggle.addEventListener('click', async () => {
        const nowOn = toggle.classList.contains('is-on');
        const next = nowOn ? 'contain' : 'cover';
        toggle.classList.toggle('is-on', !nowOn);
        toggle.setAttribute('aria-pressed', String(!nowOn));
        if (label) label.textContent = next === 'cover' ? 'Cover (crop)' : 'Contain (penuh)';
        await _callbacks.onToggleSlideshowFit?.().catch(_logErr);
      });
    }
  }, 0);

  container.appendChild(section.el);
}

// ─── Category: Teks ───────────────────────────────────────────────────────

function _renderTeks(container) {
  // Running text
  const section1 = _createSection('Running Text', 'ic-text');
  const cfg = _getSettings();
  const tickerRow = document.createElement('div');
  tickerRow.innerHTML = `<textarea id="op-field-ticker" class="op-field" rows="3" placeholder="Satu baris = satu pesan">${_escHtml(cfg.tickerMessageText || '')}</textarea>`;
  section1.body.appendChild(tickerRow);

  const tickerBtnRow = document.createElement('div');
  tickerBtnRow.className = 'op-btn-row';
  const tickerSave = document.createElement('button');
  tickerSave.className = 'op-btn op-btn-primary';
  tickerSave.type = 'button';
  tickerSave.textContent = 'Simpan Running Text';
  tickerSave.addEventListener('click', async () => {
    const value = document.getElementById('op-field-ticker').value.trim();
    const { save, get } = await import('../services/settings.js');
    await save({ tickerMessageText: value });
    _callbacks.onSettingsChanged?.(await get());
    _showToast('Running text disimpan');
  });
  tickerBtnRow.appendChild(tickerSave);
  section1.body.appendChild(tickerBtnRow);
  container.appendChild(section1.el);

  // Side messages
  const section2 = _createSection('Pesan Samping', null);
  const sideMessages = Array.isArray(cfg.sideMessages) ? cfg.sideMessages.join('\n') : '';
  const sideRow = document.createElement('div');
  sideRow.innerHTML = `<textarea id="op-field-side" class="op-field" rows="3" placeholder="Satu baris = satu pesan">${_escHtml(sideMessages)}</textarea>`;
  section2.body.appendChild(sideRow);

  const sideBtnRow = document.createElement('div');
  sideBtnRow.className = 'op-btn-row';
  const sideSave = document.createElement('button');
  sideSave.className = 'op-btn op-btn-primary';
  sideSave.type = 'button';
  sideSave.textContent = 'Simpan Pesan Samping';
  sideSave.addEventListener('click', async () => {
    const value = document.getElementById('op-field-side').value.trim();
    const lines = value ? value.split('\n').map(l => l.trim()).filter(l => l) : [];
    const { save, get } = await import('../services/settings.js');
    await save({ sideMessages: lines });
    _callbacks.onSettingsChanged?.(await get());
    _showToast('Pesan samping disimpan');
  });
  sideBtnRow.appendChild(sideSave);
  section2.body.appendChild(sideBtnRow);
  container.appendChild(section2.el);

  // Custom text link
  const section3 = _createSection('Kostum Teks', null);
  const ctRow = document.createElement('div');
  ctRow.className = 'op-btn-row';
  const ctBtn = document.createElement('button');
  ctBtn.className = 'op-btn';
  ctBtn.type = 'button';
  ctBtn.innerHTML = '<svg class="op-icon"><use href="#ic-text"/>svg> Buka Editor Kostum Teks (20 entri)';
  ctBtn.addEventListener('click', () => _showSubPanel('custom-text'));
  ctRow.appendChild(ctBtn);
  section3.body.appendChild(ctRow);
  container.appendChild(section3.el);
}

// ─── Category: Jadwal ─────────────────────────────────────────────────────

function _renderJadwal(container) {
  // Location
  const section1 = _createSection('Lokasi & Sinkron', 'ic-location');
  const cfg = _getSettings();

  const locInfo = document.createElement('div');
  locInfo.style.cssText = 'font-size:0.82rem;color:var(--color-text-soft);margin-bottom:0.5rem;';
  locInfo.textContent = `Lokasi aktif: ${cfg.prayerLocationName || '-'} | Sinkron: ${cfg.prayerLastSyncStatus || 'never'}`;
  section1.body.appendChild(locInfo);

  const locBtnRow = document.createElement('div');
  locBtnRow.className = 'op-btn-row';

  const locBtn = document.createElement('button');
  locBtn.className = 'op-btn';
  locBtn.type = 'button';
  locBtn.innerHTML = '<svg class="op-icon"><use href="#ic-location"/>svg> Ubah Lokasi';
  locBtn.addEventListener('click', async () => {
    close();
    await _callbacks.onConfigurePrayerLocation?.().catch(_logErr);
  });
  locBtnRow.appendChild(locBtn);

  const syncBtn = document.createElement('button');
  syncBtn.className = 'op-btn op-btn-primary';
  syncBtn.type = 'button';
  syncBtn.innerHTML = '<svg class="op-icon"><use href="#ic-sync"/>svg> Sinkron Jadwal';
  syncBtn.addEventListener('click', async () => {
    close();
    await _callbacks.onReloadSchedule?.().catch(_logErr);
    _showToast('Sinkronisasi dimulai...');
  });
  locBtnRow.appendChild(syncBtn);
  section1.body.appendChild(locBtnRow);
  container.appendChild(section1.el);

  // Durasi fase
  const section2 = _createSection('Durasi Fase Sholat', 'ic-clock');
  const prayerKeys = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
  const prayerLabels = { subuh: 'Subuh', dzuhur: 'Zuhur', ashar: 'Ashar', maghrib: 'Magrib', isya: 'Isya' };
  const phaseLabels = ['Countdown Adzan', 'Lama Adzan', 'Countdown Iqomah'];

  for (const pKey of prayerKeys) {
    const pCfg = cfg.prayerPhaseDurations?.[pKey] || {};
    const pSection = _createSection(prayerLabels[pKey] || pKey, null);
    pSection.el.style.marginBottom = '0.5rem';

    const fields = [
      { key: 'preAzanMinutes', label: phaseLabels[0], def: 5 },
      { key: 'azanDisplayMinutes', label: phaseLabels[1], def: 3 },
      { key: 'iqomahDelayMinutes', label: phaseLabels[2], def: 10 },
    ];

    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'op-field-row';
      row.style.gridTemplateColumns = '7rem 1fr';
      const val = pCfg[f.key] ?? f.def;
      row.innerHTML = `
        <span class="op-field-row-label">${f.label}</span>
        <div class="op-stepper">
          <button class="op-stepper-btn op-stepper-minus" type="button">−</button>
          <span class="op-stepper-value" data-key="${pKey}" data-field="${f.key}">${val}</span>
          <button class="op-stepper-btn op-stepper-plus" type="button">+</button>
        </div>
      `;
      pSection.body.appendChild(row);
    }

    // Bind stepper buttons
    const stepperDiv = pSection.body.querySelectorAll('.op-stepper');
    stepperDiv.forEach(stepper => {
      const minusBtn = stepper.querySelector('.op-stepper-minus');
      const plusBtn = stepper.querySelector('.op-stepper-plus');
      const valSpan = stepper.querySelector('.op-stepper-value');
      const fKey = valSpan.dataset.key;
      const fField = valSpan.dataset.field;

      minusBtn?.addEventListener('click', () => {
        let v = parseInt(valSpan.textContent, 10) || 1;
        if (v > 1) { v--; valSpan.textContent = String(v); _savePrayerDuration(fKey, fField, v); }
      });
      plusBtn?.addEventListener('click', () => {
        let v = parseInt(valSpan.textContent, 10) || 1;
        if (v < 60) { v++; valSpan.textContent = String(v); _savePrayerDuration(fKey, fField, v); }
      });
    });

    section2.body.appendChild(pSection.el);
  }
  container.appendChild(section2.el);
}

// ─── Category: Jumat ──────────────────────────────────────────────────────

function _renderJumat(container) {
  const cfg = _getSettings();
  const jCfg = cfg.fridayPrayerDurations || {};

  const section = _createSection('Durasi Jumat', 'ic-minbar');

  const fields = [
    { key: 'preAzanMinutes', label: 'Countdown Azan Jumat', def: 5 },
    { key: 'azanJumatDisplayMinutes', label: 'Lama Azan Jumat', def: 3 },
    { key: 'qabliyahDelayMinutes', label: 'Jeda Qabliyah', def: 2 },
    { key: 'azanKhutbahDisplayMinutes', label: 'Lama Azan Khutbah', def: 2 },
    { key: 'khutbahToIqomahMinutes', label: 'Durasi Khutbah', def: 30 },
  ];

  for (const f of fields) {
    const row = document.createElement('div');
    row.className = 'op-field-row';
    row.style.gridTemplateColumns = '8rem 1fr';
    const val = jCfg[f.key] ?? f.def;
    row.innerHTML = `
      <span class="op-field-row-label">${f.label}</span>
      <div class="op-stepper">
        <button class="op-stepper-btn op-stepper-minus" type="button">−</button>
        <span class="op-stepper-value" data-field="${f.key}">${val}</span>
        <button class="op-stepper-btn op-stepper-plus" type="button">+</button>
      </div>
    `;
    section.body.appendChild(row);
  }

  // Bind steppers
  const steppers = section.body.querySelectorAll('.op-stepper');
  steppers.forEach(stepper => {
    const minusBtn = stepper.querySelector('.op-stepper-minus');
    const plusBtn = stepper.querySelector('.op-stepper-plus');
    const valSpan = stepper.querySelector('.op-stepper-value');
    const fField = valSpan.dataset.field;

    minusBtn?.addEventListener('click', () => {
      let v = parseInt(valSpan.textContent, 10) || 1;
      const min = fField === 'khutbahToIqomahMinutes' ? 1 : 1;
      if (v > min) { v--; valSpan.textContent = String(v); _saveFridayDuration(fField, v); }
    });
    plusBtn?.addEventListener('click', () => {
      let v = parseInt(valSpan.textContent, 10) || 1;
      const max = fField === 'khutbahToIqomahMinutes' ? 180 : 60;
      if (v < max) { v++; valSpan.textContent = String(v); _saveFridayDuration(fField, v); }
    });
  });

  container.appendChild(section.el);

  // Khutbah photo
  const section2 = _createSection('Foto Khutbah', null);
  const photoRow = document.createElement('div');
  photoRow.className = 'op-btn-row';
  const photoBtn = document.createElement('button');
  photoBtn.className = 'op-btn';
  photoBtn.type = 'button';
  photoBtn.innerHTML = '<svg class="op-icon"><use href="#ic-slideshow"/>svg> Pilih Foto Khutbah';
  photoBtn.addEventListener('click', () => _showSubPanel('jumat'));
  photoRow.appendChild(photoBtn);
  section2.body.appendChild(photoRow);
  container.appendChild(section2.el);
}

// ─── Category: Simulasi (Mode Lanjutan) ───────────────────────────────────

function _renderSimulasi(container) {
  // Simulation
  const section1 = _createSection('Simulasi Waktu', 'ic-play');
  const simBtnRow = document.createElement('div');
  simBtnRow.className = 'op-btn-row';

  const startBtn = document.createElement('button');
  startBtn.className = 'op-btn op-btn-primary';
  startBtn.type = 'button';
  startBtn.innerHTML = '<svg class="op-icon"><use href="#ic-play"/>svg> Mulai Simulasi';
  startBtn.addEventListener('click', async () => {
    close();
    await _callbacks.onStartSimulation?.().catch(_logErr);
  });
  simBtnRow.appendChild(startBtn);

  const stopBtn = document.createElement('button');
  stopBtn.className = 'op-btn op-btn-danger';
  stopBtn.type = 'button';
  stopBtn.innerHTML = '<svg class="op-icon"><use href="#ic-stop"/>svg> Hentikan';
  stopBtn.addEventListener('click', async () => {
    close();
    await _callbacks.onStopSimulation?.().catch(_logErr);
    _showToast('Simulasi dihentikan');
  });
  simBtnRow.appendChild(stopBtn);
  section1.body.appendChild(simBtnRow);

  const speedBtn = document.createElement('button');
  speedBtn.className = 'op-btn';
  speedBtn.type = 'button';
  speedBtn.style.marginTop = '0.5rem';
  speedBtn.innerHTML = '<svg class="op-icon"><use href="#ic-settings"/>svg> Ubah Kecepatan';
  speedBtn.addEventListener('click', async () => {
    close();
    await _callbacks.onSetSimSpeed?.().catch(_logErr);
  });
  section1.body.appendChild(speedBtn);
  container.appendChild(section1.el);

  // System
  const section2 = _createSection('Sistem', 'ic-info');
  const sysBtnRow = document.createElement('div');
  sysBtnRow.className = 'op-btn-row';

  const resetBtn = document.createElement('button');
  resetBtn.className = 'op-btn op-btn-danger';
  resetBtn.type = 'button';
  resetBtn.innerHTML = '<svg class="op-icon"><use href="#ic-reset"/>svg> Reset Semua';
  resetBtn.addEventListener('click', async () => {
    if (!window.confirm('Reset semua pengaturan ke default? Tindakan ini tidak bisa dibatalkan.')) return;
    const { save, get } = await import('../services/settings.js');
    const { DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH } = await import('../services/slideshowLibrary.js');
    const defaults = {
      textScale: 1.0,
      stripBackgroundOpacity: 0.35,
      themePreset: 'navy',
      themeOverride: {},
      slideshowFit: 'cover',
      customText: CUSTOM_TEXT_DEFAULTS,
    };
    const nextSettings = await save(defaults);
    _callbacks.onSettingsChanged?.(nextSettings);
    _showToast('Pengaturan di-reset ke default');
  });
  sysBtnRow.appendChild(resetBtn);
  section2.body.appendChild(sysBtnRow);
  container.appendChild(section2.el);
}

// ─── Section builder helper ───────────────────────────────────────────────

function _createSection(title, iconId) {
  const el = document.createElement('div');
  el.className = 'op-section';

  const header = document.createElement('div');
  header.className = 'op-section-header';
  if (iconId) {
    header.innerHTML = `<svg class="op-icon"><use href="#iconId"/></svg> ${title}`.replace('#iconId', '#' + iconId);
  } else {
    header.textContent = title;
  }

  const body = document.createElement('div');
  body.className = 'op-section-body';

  el.appendChild(header);
  el.appendChild(body);

  return { el, body };
}

// ─── Debounced save ───────────────────────────────────────────────────────

function _debounce(key, fn) {
  if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
  _debounceTimers[key] = setTimeout(() => {
    fn().catch(() => {});
    delete _debounceTimers[key];
  }, DEBOUNCE_MS);
}

// ─── Prayer duration save ─────────────────────────────────────────────────

async function _savePrayerDuration(prayerKey, field, value) {
  const { save, get } = await import('../services/settings.js');
  const cfg = get();
  const durations = { ...(cfg.prayerPhaseDurations || {}) };
  durations[prayerKey] = { ...(durations[prayerKey] || {}), [field]: value };
  const nextSettings = await save({ prayerPhaseDurations: durations });
  _callbacks.onSettingsChanged?.(nextSettings);
}

async function _saveFridayDuration(field, value) {
  const { save, get } = await import('../services/settings.js');
  const cfg = get();
  const durations = { ...(cfg.fridayPrayerDurations || {}), [field]: value };
  const nextSettings = await save({ fridayPrayerDurations: durations });
  _callbacks.onSettingsChanged?.(nextSettings);
}

// ─── Strip opacity helper ─────────────────────────────────────────────────

function _applyStripOpacity(opacity) {
  const stripBackground = `rgba(4, 16, 36, ${opacity})`;
  ['top-header', 'ticker-bar', 'prayer-strip'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.background = stripBackground;
  });
  const badge = document.getElementById('hero-badge');
  if (badge) {
    const badgeOpacity = Math.min(1, opacity + 0.12);
    badge.style.background = `rgba(4, 16, 36, ${badgeOpacity})`;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────

function _showToast(message) {
  let toast = document.querySelector('.op-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'op-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 2500);
}

// ─── Text editor dialog (preserved for backward compat) ───────────────────

export function promptTextEditor({
  title = 'Edit Teks',
  hint = '',
  value = '',
  placeholder = '',
  kind = 'text',
} = {}) {
  const panel = document.getElementById(EDITOR_PANEL_ID);
  const titleEl = document.getElementById('text-editor-title');
  const hintEl = document.getElementById('text-editor-hint');
  const inputEl = document.getElementById('text-editor-input');

  if (!panel || !titleEl || !hintEl || !inputEl) {
    return Promise.resolve(window.prompt(title, value));
  }

  if (_editorResolver) {
    _editorResolver(null);
    _editorResolver = null;
  }

  titleEl.textContent = title;
  hintEl.textContent = hint;
  hintEl.hidden = !hint;
  inputEl.value = value;
  inputEl.placeholder = placeholder;
  panel.dataset.kind = kind;

  panel.hidden = false;

  return new Promise(resolve => {
    _editorResolver = resolve;
    requestAnimationFrame(() => {
      inputEl.focus();
      inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
    });
  });
}

function _bindTextEditor() {
  if (_editorBound) return;
  _editorBound = true;

  const panel = document.getElementById(EDITOR_PANEL_ID);
  const input = document.getElementById('text-editor-input');
  const saveButton = document.getElementById('text-editor-save');
  const cancelButton = document.getElementById('text-editor-cancel');

  if (!panel || !input || !saveButton || !cancelButton) return;

  saveButton.addEventListener('click', () => {
    _closeTextEditor(input.value);
  });

  cancelButton.addEventListener('click', () => {
    _closeTextEditor(null);
  });

  panel.addEventListener('click', event => {
    if (event.target === panel) _closeTextEditor(null);
  });
}

function _closeTextEditor(value) {
  const panel = document.getElementById(EDITOR_PANEL_ID);
  if (panel) {
    panel.hidden = true;
    delete panel.dataset.kind;
  }
  const resolve = _editorResolver;
  _editorResolver = null;
  if (resolve) resolve(value);
}

function _isEditorOpen() {
  const panel = document.getElementById(EDITOR_PANEL_ID);
  return Boolean(panel && !panel.hidden);
}

// ─── Fullscreen ───────────────────────────────────────────────────────────

export function syncFitButton(fit) {
  const button = document.getElementById('op-btn-slideshow-fit');
  if (!button) return;
  button.textContent = fit === 'contain'
    ? 'Tampilan Foto: Contain (penuh)'
    : 'Tampilan Foto: Cover (crop)';
}

function _syncFullscreenButton() {
  const button = document.getElementById('op-btn-fullscreen');
  if (!button) return;
  button.setAttribute('aria-label', _isFullscreen ? 'Keluar Fullscreen' : 'Masuk Fullscreen');
  button.title = button.getAttribute('aria-label');
}

// ─── Panel button bindings ────────────────────────────────────────────────

function _bindPanelButtons() {
  // Card clicks
  document.querySelectorAll('.op-card[data-category]').forEach(card => {
    card.addEventListener('click', () => {
      const cat = card.dataset.category;
      if (cat) _openCategory(cat);
    });
  });

  // Detail back button
  _on('op-detail-back', 'click', () => _showDashboard());

  // Close
  _on('op-btn-close', 'click', () => close());

  // Fullscreen
  _on('op-btn-fullscreen', 'click', async () => {
    if (_isFullscreen) {
      await exitFullscreen().catch(_logErr);
    } else {
      await requestFullscreen().catch(_logErr);
    }
    _isFullscreen = !_isFullscreen;
    _syncFullscreenButton();
  });

  // Click outside panel to close
  const panel = document.getElementById(PANEL_ID);
  if (panel) {
    panel.addEventListener('click', event => {
      if (event.target === panel) close();
    });
  }

  // Escape to close
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (_isPhotoPickerOpen()) {
        _closePhotoPicker();
      } else if (_isSubPanelOpen()) {
        _hideAllSubPanels();
      } else if (_isEditorOpen()) {
        _closeTextEditor(null);
      } else {
        close();
      }
    }
  });
}

// ─── Tap zone ─────────────────────────────────────────────────────────────

function _bindTapZone() {
  const zone = document.getElementById(TAP_ZONE_ID);
  if (!zone) return;

  zone.addEventListener('click', () => {
    _tapCount += 1;
    if (_tapCount === 1) {
      _tapTimer = setTimeout(() => { _tapCount = 0; }, TAP_WINDOW_MS);
    }
    if (_tapCount >= TAP_COUNT_REQUIRED) {
      clearTimeout(_tapTimer);
      _tapCount = 0;
      open();
    }
  });
}

// ─── Sub-panels (custom text, jumat, khutbah photo) ──────────────────────

function _hideAllSubPanels() {
  const panels = ['op-menu-custom-text', 'op-menu-jumat', 'khutbah-photo-panel'];
  for (const id of panels) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
}

function _isSubPanelOpen() {
  return ['op-menu-custom-text', 'op-menu-jumat', 'khutbah-photo-panel'].some(id => {
    const el = document.getElementById(id);
    return el && !el.hidden;
  });
}

function _showSubPanel(name) {
  _hideAllSubPanels();
  const el = document.getElementById(`op-menu-${name}`);
  if (el) {
    el.hidden = false;
    if (name === 'custom-text') _renderCustomTextList();
  }
}

// ─── Custom Text panel ────────────────────────────────────────────────────

function _bindCustomTextPanel() {
  _on('op-btn-custom-text-back', 'click', () => _hideAllSubPanels());
  _on('op-btn-custom-text-reset-all', 'click', async () => {
    const { save, get } = await import('../services/settings.js');
    const cfg = get();
    const nextSettings = await save({ customText: CUSTOM_TEXT_DEFAULTS });
    _customTextSettings = nextSettings;
    _renderCustomTextList();
    _callbacks.onSettingsChanged?.(nextSettings);
    _showToast('Semua teks di-reset');
  });
  // Bind custom text editor save/reset and preview updates
  const saveBtn = document.getElementById('op-ct-edit-save');
  const resetBtn = document.getElementById('op-ct-edit-reset');
  const textInput = document.getElementById('op-ct-edit-text');
  const sizeInput = document.getElementById('op-ct-edit-size');
  const colorInput = document.getElementById('op-ct-edit-color-text');
  const fontInput = document.getElementById('op-ct-edit-font');
  const previewEl = document.getElementById('op-ct-edit-preview');
  if (saveBtn && resetBtn && textInput && sizeInput && colorInput && fontInput && previewEl) {
    function updatePreview() {
      previewEl.textContent = textInput.value || '';
      previewEl.style.fontSize = sizeInput.value || '';
      previewEl.style.color = colorInput.value || '';
      previewEl.style.fontFamily = fontInput.value || '';
    }
    textInput.addEventListener('input', updatePreview);
    sizeInput.addEventListener('input', updatePreview);
    colorInput.addEventListener('input', updatePreview);
    fontInput.addEventListener('input', updatePreview);
    // Save
    saveBtn.addEventListener('click', async () => {
      if (_editingKey === null) return;
      const text = textInput.value.trim();
      const size = sizeInput.value.trim();
      const color = colorInput.value.trim();
      const font = fontInput.value.trim();
      const { save, get } = await import('../services/settings.js');
      const cfg = get();
      const customText = { ...(cfg.customText ?? CUSTOM_TEXT_DEFAULTS) };
      const def = CUSTOM_TEXT_DEFAULTS[_editingKey];
      customText[_editingKey] = {
        text: text || def.text,
        size: size || def.size,
        color: color,
        font: font,
      };
      const nextSettings = await save({ customText });
      _customTextSettings = nextSettings;
      _renderCustomTextList();
      _callbacks.onSettingsChanged?.(await get());
      _showToast('Teks disimpan');
      _editingKey = null;
    });
    // Reset
    resetBtn.addEventListener('click', async () => {
      if (_editingKey === null) return;
      const { save, get } = await import('../services/settings.js');
      const cfg = get();
      const customText = { ...(cfg.customText ?? CUSTOM_TEXT_DEFAULTS) };
      customText[_editingKey] = { ...CUSTOM_TEXT_DEFAULTS[_editingKey] };
      const nextSettings = await save({ customText });
      _customTextSettings = nextSettings;
      _renderCustomTextList();
      _callbacks.onSettingsChanged?.(await get());
      _showToast('Teks di-reset ke default');
      _editingKey = null;
      // reset form to default
      const def = CUSTOM_TEXT_DEFAULTS[_editingKey];
      textInput.value = def.text ?? '';
      sizeInput.value = def.size ?? '';
      colorInput.value = '';
      fontInput.value = '';
      updatePreview();
    });
  }
}

function _renderCustomTextList() {
  const list = document.getElementById('op-custom-text-list');
  if (!list) return;

  const settings = _customTextSettings;
  const customText = settings?.customText ?? CUSTOM_TEXT_DEFAULTS;

  list.innerHTML = '';

  // Search box
  const searchWrap = document.createElement('div');
  searchWrap.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:0.75rem;';
  searchWrap.innerHTML = `
    <svg class="op-icon" style="width:1rem;height:1rem;color:var(--color-text-soft);flex-shrink:0;margin-top:0.5rem;"><use href="#ic-search"/></svg>
    <input id="op-ct-search" class="op-field" type="text" placeholder="Cari teks..." style="min-height:2.2rem;font-size:0.82rem;">
  `;
  list.appendChild(searchWrap);

  const itemsContainer = document.createElement('div');
  itemsContainer.id = 'op-ct-items';
  list.appendChild(itemsContainer);

  _renderCustomTextItems(itemsContainer, customText, '');

  // Search filter
  const searchInput = document.getElementById('op-ct-search');
  searchInput?.addEventListener('input', () => {
    _renderCustomTextItems(itemsContainer, customText, searchInput.value.toLowerCase());
  });
}

function _renderCustomTextItems(container, customText, filter) {
  container.innerHTML = '';

  for (const group of CUSTOM_TEXT_GROUPS) {
    const groupKeys = group.keys.filter(key => {
      if (!filter) return true;
      const label = (CUSTOM_TEXT_LABELS[key] || key).toLowerCase();
      const entry = customText[key] || CUSTOM_TEXT_DEFAULTS[key];
      const text = (entry?.text || entry || '').toLowerCase();
      return label.includes(filter) || text.includes(filter);
    });

    if (groupKeys.length === 0) continue;

    // Group header
    const groupHeader = document.createElement('div');
    groupHeader.style.cssText = 'font-size:0.75rem;font-weight:700;color:var(--op-accent);padding:0.5rem 0 0.25rem;text-transform:uppercase;letter-spacing:0.04em;';
    groupHeader.textContent = group.label;
    container.appendChild(groupHeader);

    for (const key of groupKeys) {
      const row = document.createElement('div');
      row.className = 'op-custom-text-item';

      const info = document.createElement('div');
      info.className = 'op-custom-text-info';

      const label = document.createElement('span');
      label.className = 'op-custom-text-label';
      label.textContent = CUSTOM_TEXT_LABELS[key] ?? key;

      const current = document.createElement('span');
      current.className = 'op-custom-text-current';
      const entry = customText[key] || CUSTOM_TEXT_DEFAULTS[key];
      const displayText = entry?.text ?? entry ?? '';
      current.textContent = displayText;
      current.title = displayText;

      // Style badges
      const badges = document.createElement('span');
      badges.className = 'op-custom-text-badges';
      if (entry?.size && entry.size !== CUSTOM_TEXT_DEFAULTS[key].size) {
        const badge = document.createElement('span');
        badge.className = 'op-custom-text-badge';
        badge.textContent = 'size';
        badges.appendChild(badge);
      }
      if (entry?.color) {
        const badge = document.createElement('span');
        badge.className = 'op-custom-text-badge';
        badge.textContent = 'color';
        badges.appendChild(badge);
      }
      if (entry?.font) {
        const badge = document.createElement('span');
        badge.className = 'op-custom-text-badge';
        badge.textContent = 'font';
        badges.appendChild(badge);
      }

      info.appendChild(label);
      info.appendChild(current);
      if (badges.children.length > 0) info.appendChild(badges);

      const actions = document.createElement('div');
      actions.className = 'op-custom-text-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => _editCustomTextKey(key));

      const resetBtn = document.createElement('button');
      resetBtn.type = 'button';
      resetBtn.textContent = 'Reset';
      resetBtn.className = 'op-btn-secondary';
      resetBtn.addEventListener('click', async () => {
        const { save, get } = await import('../services/settings.js');
        const cfg = get();
        const newCustomText = { ...(cfg.customText ?? CUSTOM_TEXT_DEFAULTS), [key]: { ...CUSTOM_TEXT_DEFAULTS[key] } };
        const nextSettings = await save({ customText: newCustomText });
        _customTextSettings = nextSettings;
        _renderCustomTextList();
        _callbacks.onSettingsChanged?.(nextSettings);
        _showToast(`Teks "${CUSTOM_TEXT_LABELS[key]}" di-reset`);
      });

      actions.appendChild(editBtn);
      actions.appendChild(resetBtn);

      row.appendChild(info);
      row.appendChild(actions);
      container.appendChild(row);
    }
  }
}

async function _editCustomTextKey(key) {
  _editingKey = key;
  const label = CUSTOM_TEXT_LABELS[key] ?? key;
  const currentEntry = _customTextSettings?.customText?.[key] ?? CUSTOM_TEXT_DEFAULTS[key];
  const defaultEntry = CUSTOM_TEXT_DEFAULTS[key];

  // Populate form
  const textInput = document.getElementById('op-ct-edit-text');
  const sizeInput = document.getElementById('op-ct-edit-size');
  const colorInput = document.getElementById('op-ct-edit-color-text');
  const fontInput = document.getElementById('op-ct-edit-font');
  const previewEl = document.getElementById('op-ct-edit-preview');
  if (textInput) textInput.value = currentEntry?.text ?? defaultEntry.text ?? '';
  if (sizeInput) sizeInput.value = currentEntry?.size ?? defaultEntry.size ?? '';
  if (colorInput) colorInput.value = currentEntry?.color ?? '';
  if (fontInput) fontInput.value = currentEntry?.font ?? '';
  // Update preview
  if (previewEl) {
    previewEl.textContent = textInput.value || '';
    previewEl.style.fontSize = sizeInput.value || '';
    previewEl.style.color = colorInput.value || '';
    previewEl.style.fontFamily = fontInput.value || '';
  }
  // Ensure the custom text sub-panel is visible (it should be when we call this from list)
  // No need to hide/show; just focus the text input
  if (textInput) textInput.focus();
}

// ─── Khutbah Photo panel ──────────────────────────────────────────────────

function _bindKhutbahPhotoPanel() {
  _on('op-btn-khutbah-photo', 'click', () => _openPhotoPicker());
  _on('op-btn-jumat-back', 'click', () => _hideAllSubPanels());
  _on('khutbah-photo-cancel', 'click', () => _closePhotoPicker());
  _on('khutbah-photo-save', 'click', () => _confirmKhutbahPhoto());
}

function _openPhotoPicker() {
  _hideAllSubPanels();
  const panel = document.getElementById('khutbah-photo-panel');
  if (!panel) return;
  _khutbahImages = [];
  _khutbahSelectedFile = null;
  _loadSlideshowImages().then(images => {
    _khutbahImages = images;
    _renderPhotoGrid();
    panel.hidden = false;
  }).catch(() => {
    _khutbahImages = [];
    _renderPhotoGrid();
    panel.hidden = false;
  });
}

async function _loadSlideshowImages() {
  try {
    const resp = await fetch('./assets/slideshow/manifest.json', { cache: 'no-store' });
    if (!resp.ok) return [];
    const data = await resp.json();
    const images = Array.isArray(data) ? data : data?.images;
    if (!Array.isArray(images)) return [];
    return images.filter(f => f && typeof f === 'string');
  } catch (_) { return []; }
}

function _renderPhotoGrid() {
  const grid = document.getElementById('khutbah-photo-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const currentKhutbah = _customTextSettings?.khutbahImage ?? null;

  if (_khutbahImages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'khutbah-photo-empty';
    empty.textContent = 'Tidak ada foto slideshow. Upload foto terlebih dahulu.';
    grid.appendChild(empty);
    return;
  }

  for (const fileName of _khutbahImages) {
    const item = document.createElement('div');
    item.className = 'khutbah-photo-item';
    if (fileName === currentKhutbah) item.classList.add('is-selected');

    const img = document.createElement('img');
    img.src = `./assets/slideshow/${encodeURIComponent(fileName)}`;
    img.alt = fileName;
    img.loading = 'lazy';

    const name = document.createElement('span');
    name.className = 'khutbah-photo-name';
    name.textContent = fileName;

    item.appendChild(img);
    item.appendChild(name);
    item.addEventListener('click', () => {
      for (const child of grid.children) child.classList.remove('is-selected');
      item.classList.add('is-selected');
      _khutbahSelectedFile = fileName;
      _showPhotoPreview(fileName);
    });
    grid.appendChild(item);
  }
}

function _showPhotoPreview(fileName) {
  const preview = document.getElementById('khutbah-photo-preview');
  const previewImg = document.getElementById('khutbah-photo-preview-img');
  const previewName = document.getElementById('khutbah-photo-preview-name');
  if (!preview || !previewImg || !previewName) return;
  previewImg.src = `./assets/slideshow/${encodeURIComponent(fileName)}`;
  previewName.textContent = fileName;
  preview.hidden = false;
}

function _closePhotoPicker() {
  const panel = document.getElementById('khutbah-photo-panel');
  if (panel) panel.hidden = true;
  _khutbahSelectedFile = null;
  _khutbahImages = [];
}

function _isPhotoPickerOpen() {
  const panel = document.getElementById('khutbah-photo-panel');
  return panel && !panel.hidden;
}

async function _confirmKhutbahPhoto() {
  if (!_khutbahSelectedFile) return;
  const { save, get } = await import('../services/settings.js');
  const cfg = get();
  const nextSettings = await save({ khutbahImage: _khutbahSelectedFile });
  _customTextSettings = nextSettings;
  _callbacks.onSettingsChanged?.(nextSettings);
  _closePhotoPicker();
  _showToast('Foto khutbah disimpan');
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function _getSettings() {
  // settings.get() returns a normalized snapshot of the current in-memory settings.
  try {
    return getCurrentSettings() || _customTextSettings || {};
  } catch (_) {
    return _customTextSettings || {};
  }
}

function _escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function _on(id, event, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(event, handler);
}

function _logErr(error) {
  log(`Operator panel error: ${error?.message ?? error}`, 'ERROR').catch(() => {});
}

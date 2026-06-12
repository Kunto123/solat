/**
 * ui/operator.js - Hidden operator panel, text editor dialog, custom text menu, khutbah photo picker.
 */

import { exitFullscreen, log, requestFullscreen } from '../services/platform.js';
import { CUSTOM_TEXT_DEFAULTS } from '../services/settings.js';

const TAP_ZONE_ID = 'op-tap-zone';
const PANEL_ID = 'operator-panel';
const EDITOR_PANEL_ID = 'text-editor-panel';
const TAP_COUNT_REQUIRED = 5;
const TAP_WINDOW_MS = 3000;

// Human-readable labels for each custom text key
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

const CUSTOM_TEXT_ORDER = [
  'focusMenujuAdzan', 'focusMenujuAzanJumat', 'focusWaktuAdzan', 'focusWaktuAzanJumat',
  'focusIqomah', 'focusPukul', 'focusJedaQabliyah', 'focusAzanKhutbah',
  'focusWaktuAzanKhutbah', 'focusIqomahJumat', 'focusAzanKhutbahName',
  'prayerLabelImsak', 'prayerLabelSubuh', 'prayerLabelSyuruq', 'prayerLabelDzuhur',
  'prayerLabelJumat', 'prayerLabelAshar', 'prayerLabelMaghrib', 'prayerLabelIsya',
  'heroIqomahPrefix', 'simBannerLabel',
];

let _tapCount = 0;
let _tapTimer = null;
let _callbacks = {};
let _isFullscreen = false;
let _editorBound = false;
let _editorResolver = null;
let _activeMenu = 'main';
let _customTextSettings = null;
let _khutbahSelectedFile = null;
let _khutbahImages = [];

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

export function open() {
  const panel = document.getElementById(PANEL_ID);
  if (!panel) return;

  _showMenu('main');
  _syncFullscreenButton();
  panel.hidden = false;
  panel.focus();
}

export function close() {
  const panel = document.getElementById(PANEL_ID);
  if (panel) panel.hidden = true;
  _showMenu('main');
  _hideAllSubPanels();
}

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

function _bindTapZone() {
  const zone = document.getElementById(TAP_ZONE_ID);
  if (!zone) return;

  zone.addEventListener('click', () => {
    _tapCount += 1;

    if (_tapCount === 1) {
      _tapTimer = setTimeout(() => {
        _tapCount = 0;
      }, TAP_WINDOW_MS);
    }

    if (_tapCount >= TAP_COUNT_REQUIRED) {
      clearTimeout(_tapTimer);
      _tapCount = 0;
      open();
    }
  });
}

function _bindPanelButtons() {
  // -- Main menu: group navigation --
  _on('op-btn-group-tampilan', 'click', () => _showMenu('tampilan'));
  _on('op-btn-group-jadwal', 'click', () => _showMenu('jadwal'));
  _on('op-btn-group-simulasi', 'click', () => _showMenu('simulasi'));
  _on('op-btn-group-sistem', 'click', () => _showMenu('sistem'));

  // -- Tampilan submenu --
  _on('op-btn-identity', 'click', async () => {
    close();
    await _callbacks.onConfigureIdentity?.().catch(_logErr);
  });

  _on('op-btn-ticker', 'click', async () => {
    close();
    await _callbacks.onEditTickerMessage?.().catch(_logErr);
  });

  _on('op-btn-side-message', 'click', async () => {
    close();
    await _callbacks.onEditSideMessages?.().catch(_logErr);
  });

  _on('op-btn-text-scale', 'click', async () => {
    close();
    await _callbacks.onConfigureTextScale?.().catch(_logErr);
  });

  _on('op-btn-theme', 'click', async () => {
    close();
    await _callbacks.onConfigureTheme?.().catch(_logErr);
  });

  _on('op-btn-add-photo', 'click', async () => {
    close();
    await _callbacks.onAddSlideshowPhotos?.().catch(_logErr);
  });

  _on('op-btn-slideshow-fit', 'click', async () => {
    await _callbacks.onToggleSlideshowFit?.().catch(_logErr);
  });

  _on('op-btn-strip-opacity', 'click', async () => {
    close();
    await _callbacks.onAdjustStripOpacity?.().catch(_logErr);
  });

  _on('op-btn-custom-text', 'click', () => _showSubPanel('custom-text'));

  _on('op-btn-tampilan-back', 'click', () => _showMenu('main'));

  // -- Jadwal & Waktu submenu --
  _on('op-btn-location', 'click', async () => {
    close();
    await _callbacks.onConfigurePrayerLocation?.().catch(_logErr);
  });

  _on('op-btn-reload', 'click', async () => {
    close();
    await _callbacks.onReloadSchedule?.().catch(_logErr);
  });

  _on('op-btn-durations', 'click', async () => {
    close();
    await _callbacks.onEditPrayerDurations?.().catch(_logErr);
  });

  _on('op-btn-friday-durations', 'click', async () => {
    close();
    await _callbacks.onEditFridayDurations?.().catch(_logErr);
  });

  _on('op-btn-jumat-settings', 'click', () => _showSubPanel('jumat'));

  _on('op-btn-jadwal-back', 'click', () => _showMenu('main'));

  // -- Simulasi submenu --
  _on('op-btn-sim-start', 'click', async () => {
    close();
    await _callbacks.onStartSimulation?.().catch(_logErr);
  });

  _on('op-btn-sim-speed', 'click', async () => {
    close();
    await _callbacks.onSetSimSpeed?.().catch(_logErr);
  });

  _on('op-btn-sim-stop', 'click', async () => {
    close();
    await _callbacks.onStopSimulation?.().catch(_logErr);
  });

  _on('op-btn-simulasi-back', 'click', () => _showMenu('main'));

  // -- Sistem submenu --
  _on('op-btn-fullscreen', 'click', async () => {
    if (_isFullscreen) {
      await exitFullscreen().catch(_logErr);
    } else {
      await requestFullscreen().catch(_logErr);
    }

    _isFullscreen = !_isFullscreen;
    _syncFullscreenButton();
  });

  _on('op-btn-sistem-close', 'click', () => close());

  // -- Close buttons --
  _on('op-btn-close', 'click', () => close());

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
    if (event.target === panel) {
      _closeTextEditor(null);
    }
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

  button.textContent = _isFullscreen ? 'Keluar Fullscreen' : 'Masuk Fullscreen';
}

function _showMenu(view) {
  const title = document.getElementById('op-title');
  const menus = {
    main: 'Panel Operator',
    tampilan: 'Tampilan',
    jadwal: 'Jadwal & Waktu',
    simulasi: 'Simulasi',
    sistem: 'Sistem',
  };

  _activeMenu = view in menus ? view : 'main';

  // Hide all submenus
  for (const name of Object.keys(menus)) {
    const el = document.getElementById(`op-menu-${name}`);
    if (el) el.hidden = name !== _activeMenu;
  }

  if (title) {
    title.textContent = menus[_activeMenu] ?? menus.main;
  }
}

// --- Sub-panels (custom text, jumat, khutbah photo) -----------------------

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

// --- Custom Text panel ----------------------------------------------------

function _bindCustomTextPanel() {
  _on('op-btn-custom-text-back', 'click', () => _hideAllSubPanels());
  _on('op-btn-custom-text-reset-all', 'click', async () => {
    const { save } = await import('../services/settings.js');
    const { get } = await import('../services/settings.js');
    const cfg = get();
    const nextSettings = await save({ customText: CUSTOM_TEXT_DEFAULTS });
    _customTextSettings = nextSettings;
    _renderCustomTextList();
    _callbacks.onSettingsChanged?.(nextSettings);
  });
}

function _renderCustomTextList() {
  const list = document.getElementById('op-custom-text-list');
  if (!list) return;

  const settings = _customTextSettings;
  const customText = settings?.customText ?? CUSTOM_TEXT_DEFAULTS;

  list.innerHTML = '';

  for (const key of CUSTOM_TEXT_ORDER) {
    const row = document.createElement('div');
    row.className = 'op-custom-text-item';

    const info = document.createElement('div');
    info.className = 'op-custom-text-info';

    const label = document.createElement('span');
    label.className = 'op-custom-text-label';
    label.textContent = CUSTOM_TEXT_LABELS[key] ?? key;

    const current = document.createElement('span');
    current.className = 'op-custom-text-current';
    const entry = customText[key] ?? CUSTOM_TEXT_DEFAULTS[key];
    const displayText = entry?.text ?? entry ?? '';
    current.textContent = displayText;
    current.title = displayText;

    // Show style badges
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
    });

    actions.appendChild(editBtn);
    actions.appendChild(resetBtn);

    row.appendChild(info);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

async function _editCustomTextKey(key) {
  const label = CUSTOM_TEXT_LABELS[key] ?? key;
  const currentEntry = _customTextSettings?.customText?.[key] ?? CUSTOM_TEXT_DEFAULTS[key];
  const defaultEntry = CUSTOM_TEXT_DEFAULTS[key];

  // Use the enhanced text editor with style fields
  const result = await _promptCustomTextEditor({
    title: `Edit: ${label}`,
    hint: `Teks yang ditampilkan di layar. Atur ukuran, warna, dan font sesuai keinginan.`,
    text: currentEntry?.text ?? '',
    size: currentEntry?.size ?? '',
    color: currentEntry?.color ?? '',
    font: currentEntry?.font ?? '',
    defaultText: defaultEntry.text,
    defaultSize: defaultEntry.size,
    defaultColor: '',
    defaultFont: '',
  });

  if (result === null) return;

  const { save, get } = await import('../services/settings.js');
  const cfg = get();
  const newCustomText = {
    ...(cfg.customText ?? CUSTOM_TEXT_DEFAULTS),
    [key]: {
      text: result.text.trim() || defaultEntry.text,
      size: result.size.trim() || defaultEntry.size,
      color: result.color.trim(),
      font: result.font.trim(),
    },
  };
  const nextSettings = await save({ customText: newCustomText });
  _customTextSettings = nextSettings;
  _renderCustomTextList();
  _callbacks.onSettingsChanged?.(nextSettings);
}

function _promptCustomTextEditor({ title, hint, text, size, color, font, defaultText, defaultSize, defaultColor, defaultFont }) {
  const panel = document.getElementById(EDITOR_PANEL_ID);
  const titleEl = document.getElementById('text-editor-title');
  const hintEl = document.getElementById('text-editor-hint');
  const inputEl = document.getElementById('text-editor-input');
  const styleFields = document.getElementById('text-editor-style-fields');
  const sizeEl = document.getElementById('text-editor-size');
  const colorEl = document.getElementById('text-editor-color');
  const colorTextEl = document.getElementById('text-editor-color-text');
  const fontEl = document.getElementById('text-editor-font');
  const previewEl = document.getElementById('text-editor-style-preview-text');
  const saveButton = document.getElementById('text-editor-save');
  const cancelButton = document.getElementById('text-editor-cancel');

  if (!panel || !titleEl || !hintEl || !inputEl || !styleFields || !sizeEl || !colorEl || !colorTextEl || !fontEl || !previewEl || !saveButton || !cancelButton) {
    return Promise.resolve(null);
  }

  if (_editorResolver) {
    _editorResolver(null);
    _editorResolver = null;
  }

  titleEl.textContent = title;
  hintEl.textContent = hint;
  hintEl.hidden = !hint;
  inputEl.value = text;
  inputEl.placeholder = defaultText;
  sizeEl.value = size;
  sizeEl.placeholder = defaultSize;
  colorEl.value = color || '#ffffff';
  colorTextEl.value = color;
  colorTextEl.placeholder = defaultColor || '#ffffff';
  fontEl.value = font;
  fontEl.placeholder = defaultFont || '';
  previewEl.textContent = text || defaultText;
  previewEl.style.fontSize = size || defaultSize;
  previewEl.style.color = color || '';
  previewEl.style.fontFamily = font || '';

  // Show style fields
  styleFields.hidden = false;
  panel.dataset.kind = 'custom-text';

  panel.hidden = false;

  // Live preview update
  function updatePreview() {
    previewEl.textContent = inputEl.value || defaultText;
    previewEl.style.fontSize = sizeEl.value || defaultSize;
    const col = colorTextEl.value || colorEl.value || '';
    previewEl.style.color = col;
    previewEl.style.fontFamily = fontEl.value || '';
  }

  inputEl.addEventListener('input', updatePreview);
  sizeEl.addEventListener('input', updatePreview);
  fontEl.addEventListener('input', updatePreview);
  colorEl.addEventListener('input', () => {
    colorTextEl.value = colorEl.value;
    updatePreview();
  });
  colorTextEl.addEventListener('input', () => {
    // Try to update color picker if valid hex
    const val = colorTextEl.value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      colorEl.value = val;
    }
    updatePreview();
  });

  requestAnimationFrame(() => {
    inputEl.focus();
    inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
  });

  return new Promise(resolve => {
    _editorResolver = resolve;

    // Override save to return object
    const origSave = () => {
      cleanup();
      const result = {
        text: inputEl.value,
        size: sizeEl.value,
        color: colorTextEl.value || colorEl.value,
        font: fontEl.value,
      };
      _closeTextEditor(result);
    };

    const origCancel = () => {
      cleanup();
      _closeTextEditor(null);
    };

    function cleanup() {
      saveButton.removeEventListener('click', origSave);
      cancelButton.removeEventListener('click', origCancel);
      inputEl.removeEventListener('input', updatePreview);
      sizeEl.removeEventListener('input', updatePreview);
      fontEl.removeEventListener('input', updatePreview);
      colorEl.removeEventListener('input', colorEl._previewHandler);
      colorTextEl.removeEventListener('input', colorTextEl._previewHandler);
    }

    // Replace button handlers
    saveButton.replaceWith(saveButton.cloneNode(true));
    cancelButton.replaceWith(cancelButton.cloneNode(true));

    const newSave = document.getElementById('text-editor-save');
    const newCancel = document.getElementById('text-editor-cancel');

    newSave.addEventListener('click', origSave);
    newCancel.addEventListener('click', origCancel);
  });
}

// --- Khutbah Photo panel --------------------------------------------------

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

  // Gather images from slideshow folder
  _khutbahImages = [];
  _khutbahSelectedFile = null;

  // Try to get images from the slideshow service's current image list
  // We'll use the manifest/API approach
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
  // Fetch the manifest to get available images
  try {
    const resp = await fetch('./assets/slideshow/manifest.json', { cache: 'no-store' });
    if (!resp.ok) return [];
    const data = await resp.json();
    const images = Array.isArray(data) ? data : data?.images;
    if (!Array.isArray(images)) return [];
    return images.filter(f => f && typeof f === 'string');
  } catch (_) {
    return [];
  }
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
    if (fileName === currentKhutbah) {
      item.classList.add('is-selected');
    }

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
      // Deselect all
      for (const child of grid.children) {
        child.classList.remove('is-selected');
      }
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
  if (!_khutbahSelectedFile) {
    return;
  }

  const { save, get } = await import('../services/settings.js');
  const cfg = get();
  const nextSettings = await save({ khutbahImage: _khutbahSelectedFile });
  _customTextSettings = nextSettings;
  _callbacks.onSettingsChanged?.(nextSettings);
  _closePhotoPicker();
}

// --- Helpers ---------------------------------------------------------------

function _on(id, event, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(event, handler);
}

function _logErr(error) {
  log(`Operator panel error: ${error?.message ?? error}`, 'ERROR').catch(() => {});
}

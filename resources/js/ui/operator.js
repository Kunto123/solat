/**
 * ui/operator.js - Hidden operator panel and text editor dialog.
 */

import { exitFullscreen, log, requestFullscreen } from '../services/platform.js';

const TAP_ZONE_ID = 'op-tap-zone';
const PANEL_ID = 'operator-panel';
const EDITOR_PANEL_ID = 'text-editor-panel';
const TAP_COUNT_REQUIRED = 5;
const TAP_WINDOW_MS = 3000;

let _tapCount = 0;
let _tapTimer = null;
let _callbacks = {};
let _isFullscreen = false;
let _editorBound = false;
let _editorResolver = null;
let _activeMenu = 'main';

export function init(callbacks) {
  _callbacks = callbacks ?? {};
  _bindTapZone();
  _bindPanelButtons();
  _bindTextEditor();

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
  // ── Main menu: group navigation ──
  _on('op-btn-group-tampilan', 'click', () => _showMenu('tampilan'));
  _on('op-btn-group-jadwal', 'click', () => _showMenu('jadwal'));
  _on('op-btn-group-simulasi', 'click', () => _showMenu('simulasi'));
  _on('op-btn-group-sistem', 'click', () => _showMenu('sistem'));

  // ── Tampilan submenu ──
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

  _on('op-btn-tampilan-back', 'click', () => _showMenu('main'));

  // ── Jadwal & Waktu submenu ──
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

  _on('op-btn-jadwal-back', 'click', () => _showMenu('main'));

  // ── Simulasi submenu ──
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

  // ── Sistem submenu ──
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

  // ── Close buttons ──
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
      if (_isEditorOpen()) {
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

function _on(id, event, handler) {
  const element = document.getElementById(id);
  if (element) element.addEventListener(event, handler);
}

function _logErr(error) {
  log(`Operator panel error: ${error?.message ?? error}`, 'ERROR').catch(() => {});
}

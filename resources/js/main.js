/**
 * main.js - Bootstrap entry point.
 */

import * as store from './core/store.js';
import * as fsm from './core/fsm.js';
import * as clock from './services/clock.js';
import * as prayer from './services/prayerTimeline.js';
import * as settings from './services/settings.js';
import * as timeController from './services/timeController.js';
import * as slideshow from './services/slideshow.js';
import * as prayerApi from './services/prayerApi.js';
import * as prayerSync from './services/prayerSync.js';
import * as audioCue from './services/audioCue.js';
import * as provider from './providers/prayerScheduleHybrid.js';
import * as render from './ui/render.js';
import * as operator from './ui/operator.js';
import { syncFitButton } from './ui/operator.js';
import * as browserImageStore from './services/browserImageStore.js';
import * as slideshowServerApi from './services/slideshowServerApi.js';
import {
  broadcast,
  exitApp,
  focusWindow,
  initRuntime,
  isNeutralinoRuntime,
  log,
  onEvent,
  onReady,
  onWindowClose,
  showMessageBox,
  storageGet,
  storageRemove,
  storageSet,
} from './services/platform.js';
import {
  DEFAULT_FRIDAY_PRAYER_DURATIONS,
  DEFAULT_PRAYER_PHASE_DURATIONS,
  PRAYER_PHASE_KEYS,
  DEFAULT_TICKER_MESSAGE_TEXT,
} from './services/settings.js';
import {
  DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH,
  importImagesToDefaultFolder,
  writeBundledManifest,
} from './services/slideshowLibrary.js';

const INSTANCE_LOCK_KEY = 'masjid_instance_lock';
const LOCK_HEARTBEAT_MS = 2000;
const LOCK_STALE_MS = 5000;

let _heartbeatTimer = null;
let _syncPromise = null;
let _lastObservedFsmState = fsm.STATES.BOOT;
let _simAudioPlayedStates = new Set();

async function _writeLock() {
  await storageSet(INSTANCE_LOCK_KEY, JSON.stringify({ timestamp: Date.now() }));
}

function _startHeartbeat() {
  _heartbeatTimer = setInterval(() => {
    _writeLock().catch(() => {});
  }, LOCK_HEARTBEAT_MS);
}

function _stopHeartbeat() {
  if (_heartbeatTimer === null) return;
  clearInterval(_heartbeatTimer);
  _heartbeatTimer = null;
}

async function _releaseLock() {
  _stopHeartbeat();
  try {
    await storageRemove(INSTANCE_LOCK_KEY);
  } catch (_) {}
}

async function _checkSingleInstance() {
  if (!isNeutralinoRuntime) {
    return true;
  }

  let lock = null;

  try {
    const raw = await storageGet(INSTANCE_LOCK_KEY);
    lock = JSON.parse(raw);
  } catch (_) {}

  if (lock && (Date.now() - lock.timestamp) < LOCK_STALE_MS) {
    try {
      await broadcast('masjid.focusWindow', {});
    } catch (_) {}

    await exitApp();
    return false;
  }

  await _writeLock();
  _startHeartbeat();
  return true;
}

function _onTick(now) {
  const currentFsmState = fsm.currentState();

  if (currentFsmState === fsm.STATES.ERROR) {
    store.setState({ now });
    return;
  }

  let currentPrayer = null;
  let nextPrayer = null;
  let dailySchedule = [];
  let iqomahRemainingMs = 0;

  try {
    dailySchedule = _getDisplaySchedule(now);
    currentPrayer = prayer.getCurrentPrayer(now);
    nextPrayer = prayer.getNextPrayer(now);
  } catch (_) {}

  const targetFsmState = _resolveFsmState(now, currentPrayer, nextPrayer);

  if (targetFsmState === fsm.STATES.FRIDAY_IQOMAH && currentPrayer) {
    iqomahRemainingMs = prayer.getFridayIqomahTime(currentPrayer).getTime() - now.getTime();
    iqomahRemainingMs = Math.max(0, iqomahRemainingMs);
  } else if (currentPrayer && targetFsmState !== fsm.STATES.FRIDAY_KHUTBAH && targetFsmState !== fsm.STATES.FRIDAY_IQOMAH) {
    iqomahRemainingMs = prayer.getIqomahRemainingMs(now, currentPrayer);
  }

  store.setState({
    now,
    dailySchedule,
    currentPrayer,
    nextPrayer,
    iqomahRemainingMs,
    ..._getFridayStatePatch(now, targetFsmState, currentPrayer, nextPrayer),
    ..._getScheduleStatusPatch(now),
  });

  _evaluateFsmTransitions(currentFsmState, targetFsmState);
}

function _evaluateFsmTransitions(state, targetState) {
  if (targetState !== state) {
    fsm.transition(targetState);
  }
}

function _resolveFsmState(now, currentPrayer, nextPrayer) {
  if (prayer.isFridayPreAzanWindow(now, nextPrayer)) {
    return fsm.STATES.PRE_AZAN;
  }

  if (prayer.isFridayAzanJumatWindow(now, currentPrayer)) {
    return fsm.STATES.AZAN;
  }

  if (prayer.isFridayQabliyahWindow(now, currentPrayer)) {
    return fsm.STATES.FRIDAY_QABLIYAH;
  }

  if (prayer.isFridayAzanKhutbahWindow(now, currentPrayer)) {
    return fsm.STATES.FRIDAY_KHUTBAH_AZAN;
  }

  if (prayer.isFridayKhutbahWindow(now, currentPrayer)) {
    return fsm.STATES.FRIDAY_KHUTBAH;
  }

  if (prayer.isFridayIqomahWindow(now, currentPrayer)) {
    return fsm.STATES.FRIDAY_IQOMAH;
  }

  if (prayer.isFridayPrayer(now, currentPrayer)) {
    const fridayPhaseTimes = prayer.getFridayPhaseTimes(currentPrayer);
    if (now >= fridayPhaseTimes.khutbahEnd) {
      return fsm.STATES.NORMAL;
    }
  }

  if (prayer.isPreAzanWindow(now, nextPrayer)) {
    return fsm.STATES.PRE_AZAN;
  }

  if (prayer.isAzanWindow(now, currentPrayer)) {
    return fsm.STATES.AZAN;
  }

  if (prayer.isIqomahWindow(now, currentPrayer)) {
    return fsm.STATES.IQOMAH;
  }

  if (prayer.isPostIqomahWindow(now, currentPrayer)) {
    return fsm.STATES.POST_IQOMAH;
  }

  return fsm.STATES.NORMAL;
}

function _getFridayStatePatch(now, targetFsmState, currentPrayer, nextPrayer) {
  const fridayPrayer = prayer.isFridayPrayer(now, currentPrayer)
    ? currentPrayer
    : (prayer.isFridayPrayer(now, nextPrayer) ? nextPrayer : null);

  const patch = {
    isFridayPrayer: Boolean(fridayPrayer),
    fridayPhaseRemainingMs: 0,
    fridayKhutbahAzanTime: null,
  };

  if (!fridayPrayer) return patch;

  const phaseTimes = prayer.getFridayPhaseTimes(fridayPrayer);
  patch.fridayKhutbahAzanTime = phaseTimes.azanKhutbahStart;

  if (targetFsmState === fsm.STATES.FRIDAY_QABLIYAH) {
    patch.fridayPhaseRemainingMs = Math.max(0, phaseTimes.azanKhutbahStart.getTime() - now.getTime());
  } else if (targetFsmState === fsm.STATES.FRIDAY_KHUTBAH) {
    patch.fridayPhaseRemainingMs = Math.max(0, phaseTimes.khutbahEnd.getTime() - now.getTime());
  } else if (targetFsmState === fsm.STATES.FRIDAY_IQOMAH) {
    const iqomahTime = prayer.getFridayIqomahTime(fridayPrayer);
    patch.fridayPhaseRemainingMs = Math.max(0, iqomahTime.getTime() - now.getTime());
  }

  return patch;
}

function _applySlideShowFit(fit) {
  const layer = document.getElementById('slideshow-layer');
  if (!layer) return;
  layer.dataset.fit = (fit === 'contain') ? 'contain' : 'cover';
  syncFitButton(fit);
}

async function _handleToggleSlideshowFit() {
  const current = settings.get().slideshowFit ?? 'cover';
  const next = current === 'cover' ? 'contain' : 'cover';
  await settings.save({ slideshowFit: next });
  _applySlideShowFit(next);
}

function _normalizeStripOpacity(rawValue, fallback = 0.35) {
  const parsed = Number.parseFloat(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed));
}

function _applyStripOpacity(rawOpacity) {
  const opacity = _normalizeStripOpacity(rawOpacity);
  const stripBackground = `rgba(4, 16, 36, ${opacity})`;

  ['top-header', 'ticker-bar', 'prayer-strip'].forEach(id => {
    const element = document.getElementById(id);
    if (!element) return;
    element.style.background = stripBackground;
  });

  const badge = document.getElementById('hero-badge');
  if (!badge) return;

  const badgeOpacity = Math.min(1, opacity + 0.12);
  badge.style.background = `rgba(4, 16, 36, ${badgeOpacity})`;
}

async function _handleAdjustStripOpacity() {
  const current = _normalizeStripOpacity(settings.get().stripBackgroundOpacity, 0.35);
  const raw = await operator.promptTextEditor({
    title: 'Atur Transparansi Strip',
    hint: 'Masukkan nilai 0 sampai 1 (contoh: 0.2 transparan, 0.5 sedang, 0.9 gelap).',
    value: String(current),
    placeholder: '0.35',
  });

  if (raw === null) return;

  const nextOpacity = _normalizeStripOpacity(raw, Number.NaN);
  if (!Number.isFinite(nextOpacity)) {
    await showMessageBox(
      'Nilai Tidak Valid',
      'Masukkan angka antara 0 sampai 1. Contoh: 0.35',
      'OK',
      'WARNING'
    );
    return;
  }

  const nextSettings = await settings.save({ stripBackgroundOpacity: nextOpacity });
  store.setState({ settings: nextSettings });
  _applyStripOpacity(nextOpacity);
}

async function _handleAddSlideshowPhotos() {
  if (isNeutralinoRuntime) {
    let selectedPaths = [];

    try {
      selectedPaths = await Neutralino.os.showOpenDialog('Pilih foto slideshow', {
        multiSelections: true,
        filters: [
          {
            name: 'Image files',
            extensions: ['jpg', 'jpeg', 'png', 'webp'],
          },
        ],
      });
    } catch (_) {
      return;
    }

    if (!Array.isArray(selectedPaths) || selectedPaths.length === 0) {
      return;
    }

    const result = await importImagesToDefaultFolder(selectedPaths);
    if (result.importedNames.length === 0) {
      await showMessageBox(
        'Foto Tidak Ditambahkan',
        'Tidak ada file gambar yang valid untuk dimasukkan ke slideshow.',
        'OK',
        'WARNING'
      );
      return;
    }

    const nextSettings = await settings.save({
      slideshowFolder: DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH,
    });

    await slideshow.init(nextSettings.slideshowFolder, nextSettings.slideshowIntervalMs);
    store.setState({ settings: nextSettings });

    await showMessageBox(
      'Foto Slideshow Ditambahkan',
      `${result.importedNames.length} foto berhasil diupload ke folder slideshow utama.`,
      'OK',
      'INFO'
    );
    return;
  }

  const files = await browserImageStore.pickImages({ preferDirectory: false });
  if (!files || files.length === 0) {
    await showMessageBox(
      'Foto Tidak Ditambahkan',
      'Tidak ada file gambar yang dipilih.',
      'OK',
      'WARNING'
    );
    return;
  }

  let result;
  try {
    result = await slideshowServerApi.uploadImages(files);
  } catch (error) {
    await showMessageBox(
      'Upload Gagal',
      [
        error?.message ?? 'Server upload tidak merespons.',
        '',
        'Pastikan aplikasi web dijalankan melalui server proyek (`npm start`), bukan static server biasa.',
      ].join('\n'),
      'OK',
      'ERROR'
    );
    return;
  }

  if (result.uploaded.length === 0) {
    await showMessageBox(
      'Foto Tidak Ditambahkan',
      'Server tidak menerima file gambar yang valid.',
      'OK',
      'WARNING'
    );
    return;
  }

  const nextSettings = await settings.save({
    slideshowFolder: DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH,
  });

  await slideshow.init(nextSettings.slideshowFolder, nextSettings.slideshowIntervalMs);
  store.setState({ settings: nextSettings });

  await showMessageBox(
    'Foto Slideshow Ditambahkan',
    `${result.uploaded.length} foto berhasil diupload ke server slideshow.`,
    'OK',
    'INFO'
  );
}

// ─── Simulation handlers ────────────────────────────────────────────────────
  const cfg = settings.get();
  const raw = await operator.promptTextEditor({
    title: 'Atur Durasi Fase Sholat',
    hint: [
      'Format per baris',
      'nama | countdown adzan | lama adzan | countdown iqomah',
      '',
      'Contoh',
      'subuh | 5 | 3 | 10',
      '',
      'Nama yang didukung',
      'subuh, dzuhur, ashar, maghrib, isya',
    ].join('\n'),
    value: _formatPrayerPhaseDurations(cfg.prayerPhaseDurations),
    placeholder: _formatPrayerPhaseDurations(DEFAULT_PRAYER_PHASE_DURATIONS),
    kind: 'durations',
  });

  if (raw === null) return;

  const nextSettings = await settings.save({
    prayerPhaseDurations: _parsePrayerPhaseDurations(raw, cfg.prayerPhaseDurations),
  });

  store.setState({ settings: nextSettings });
  await _loadPrayerRuntime(new Date());
  _onTick(new Date());
}

async function _handleEditFridayDurations() {
  const cfg = settings.get();
  const raw = await operator.promptTextEditor({
    title: 'Atur Durasi Jumat',
    hint: [
      'Format',
      'countdown azan jumat | lama azan jumat | jeda qabliyah | lama azan khutbah | durasi khutbah menuju iqomah',
      '',
      'Contoh',
      '5 | 3 | 2 | 2 | 30',
    ].join('\n'),
    value: _formatFridayPrayerDurations(cfg.fridayPrayerDurations),
    placeholder: _formatFridayPrayerDurations(DEFAULT_FRIDAY_PRAYER_DURATIONS),
    kind: 'durations',
  });

  if (raw === null) return;

  const nextSettings = await settings.save({
    fridayPrayerDurations: _parseFridayPrayerDurations(raw, cfg.fridayPrayerDurations),
  });

  store.setState({ settings: nextSettings });
  await _loadPrayerRuntime(new Date());
  _onTick(new Date());
}

// ─── Simulation handlers ────────────────────────────────────────────────────

async function _handleStartSimulation({ startAt, speed }) {
  timeController.startSim({ startAt, speed });
  _simAudioPlayedStates.clear();

  _bootFsm(timeController.now());
  _onTick(timeController.now());

  await log(`Simulasi dimulai: ${startAt.toISOString()} speed=${speed}x`, 'INFO');
}

async function _handleSetSimSpeed(n) {
  timeController.setSpeed(n);
  await log(`Simulasi speed diubah: ${n}x`, 'INFO');
}

async function _handleStopSimulation() {
  timeController.stopSim();
  _simAudioPlayedStates.clear();

  _bootFsm(new Date());
  _onTick(new Date());

  await log('Simulasi dihentikan, kembali ke waktu asli', 'INFO');
}

// ─── Prayer location / sync ─────────────────────────────────────────────────

async function _handleConfigurePrayerLocation() {
  const cfg = settings.get();
  const defaultKeyword = _deriveLocationKeyword(cfg.prayerLocationName);
  const keyword = window.prompt(
    'Masukkan keyword lokasi jadwal sholat. Contoh: bogor',
    defaultKeyword
  );

  if (keyword === null) return;
  if (!keyword.trim()) {
    await showMessageBox(
      'Keyword Kosong',
      'Masukkan kata kunci lokasi terlebih dahulu.',
      'OK',
      'WARNING'
    );
    return;
  }

  let results;
  try {
    results = await prayerApi.searchLocations(keyword);
  } catch (error) {
    await showMessageBox(
      'Pencarian Lokasi Gagal',
      error?.message ?? String(error),
      'OK',
      'ERROR'
    );
    return;
  }

  if (results.length === 0) {
    await showMessageBox(
      'Lokasi Tidak Ditemukan',
      `Tidak ada hasil untuk keyword "${keyword}".`,
      'OK',
      'WARNING'
    );
    return;
  }

  const maxOptions = Math.min(results.length, 9);
  const promptLines = ['Pilih nomor lokasi jadwal:'];
  for (let index = 0; index < maxOptions; index += 1) {
    promptLines.push(`${index + 1}. ${results[index].lokasi}`);
  }

  const selectedRaw = window.prompt(promptLines.join('\n'), '1');
  if (selectedRaw === null) return;

  const selectedIndex = Number(selectedRaw) - 1;
  if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= maxOptions) {
    await showMessageBox(
      'Pilihan Tidak Valid',
      'Nomor lokasi yang dipilih tidak valid.',
      'OK',
      'WARNING'
    );
    return;
  }

  const selected = results[selectedIndex];
  const nextSettings = await settings.save({
    prayerLocationId: selected.id,
    prayerLocationName: selected.lokasi,
    prayerLocationProvince: null,
    prayerLastSyncAt: null,
    prayerLastSyncStatus: 'never',
    prayerLastSyncError: null,
    prayerSyncRangeStart: null,
    prayerSyncRangeEnd: null,
  });

  store.setState({ settings: nextSettings });

  await showMessageBox(
    'Lokasi Jadwal Disimpan',
    `Lokasi aktif: ${selected.lokasi}\nSinkronisasi jadwal akan dijalankan sekarang.`,
    'OK',
    'INFO'
  );

  await _syncPrayerSchedule({ force: true, silent: false });
}

async function _handleReloadSchedule() {
  await _syncPrayerSchedule({ force: true, silent: false });
}

// ─── Identity handlers ─────────────────────────────────────────────────────

// ─── Text scale handler ────────────────────────────────────────────────────

async function _handleConfigureTextScale() {
  const cfg = settings.get();
  const current = cfg.textScale ?? 1.0;

  const raw = await operator.promptTextEditor({
    title: 'Ukuran Teks',
    hint: [
      'Masukkan pengali ukuran teks (0.7 – 1.4).',
      '',
      'Contoh:',
      '0.8  = lebih kecil',
      '1.0  = normal',
      '1.2  = lebih besar',
      '1.4  = maksimal',
    ].join('\n'),
    value: String(current),
    placeholder: '1.0',
  });

  if (raw === null) return;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    await showMessageBox(
      'Nilai Tidak Valid',
      'Masukkan angka antara 0.7 sampai 1.4. Contoh: 1.2',
      'OK',
      'WARNING'
    );
    return;
  }

  const nextSettings = await settings.save({ textScale: parsed });
  store.setState({ settings: nextSettings });
}

async function _handleChangeLogo() {
  const { save, get } = await import('../services/settings.js');
  const { showMessageBox, isNeutralinoRuntime } = await import('../services/platform.js');
  let logoPath = null;

  if (isNeutralinoRuntime) {
    try {
      const selected = await Neutralino.os.showOpenDialog('Pilih logo masjid', {
        multiSelections: false,
        filters: [{ name: 'Image files', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
      });
      if (!selected || selected.length === 0) return;
      const srcPath = selected[0];
      const ext = srcPath.split('.').pop().toLowerCase();
      const destRelDir = './resources/assets/logo';
      const absDestDir = await Neutralino.filesystem.getAbsolutePath(destRelDir);
      try { await Neutralino.filesystem.getStats(absDestDir); }
      catch (_) { await Neutralino.filesystem.createDirectory(absDestDir); }
      const destFile = `custom-logo.${ext}`;
      const absDestPath = await Neutralino.filesystem.getJoinedPath(absDestDir, destFile);
      await Neutralino.filesystem.copy(srcPath, absDestPath, { overwrite: true });
      logoPath = `assets/logo/${destFile}`;
    } catch (_) {
      return;
    }
  } else {
    // Web fallback: create a file input
    logoPath = await new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) { resolve(null); return; }
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  if (!logoPath) return;

  const nextSettings = await save({ logoPath });
  store.setState({ settings: nextSettings });
  await showMessageBox('Logo Berhasil Diubah', 'Logo masjid berhasil diperbarui.', 'OK', 'INFO');
}

// ─── Theme handler ─────────────────────────────────────────────────────────

async function _handleConfigureTheme() {
  const cfg = settings.get();
  const themeKeys = ['navy', 'hijau', 'gelap'];
  const currentIdx = themeKeys.indexOf(cfg.themePreset ?? 'navy');

  const raw = await operator.promptTextEditor({
    title: 'Tema / Style',
    hint: [
      'Pilih nomor tema:',
      '',
      ...themeKeys.map((key, i) => `${i + 1}. ${key}`),
      '',
      'Atau masukkan override warna aksen (hex, mis. #ff8800):',
      'format: accent=#ff8800',
    ].join('\n'),
    value: String(currentIdx + 1),
    placeholder: '1',
  });

  if (raw === null) return;

  const trimmed = raw.trim();

  // Check if it's a number selection
  const num = Number.parseInt(trimmed, 10);
  if (Number.isInteger(num) && num >= 1 && num <= themeKeys.length) {
    const nextSettings = await settings.save({
      themePreset: themeKeys[num - 1],
      themeOverride: {},
    });
    store.setState({ settings: nextSettings });
    return;
  }

  // Check if it's an override: accent=#hex
  const accentMatch = trimmed.match(/^accent\s*=\s*(#[0-9a-fA-F]{3,8})/i);
  if (accentMatch) {
    const accentColor = accentMatch[1];

    // Contrast check: warn if color is too close to current text color
    const isLight = _isLightColor(accentColor);
    const rootStyle = getComputedStyle(document.documentElement);
    const textColor = rootStyle.getPropertyValue('--color-text').trim();
    const textIsLight = _isLightColor(textColor);

    if (isLight === textIsLight) {
      await showMessageBox(
        'Peringatan Kontras',
        `Warna aksen ${accentColor} mungkin sulit dibaca di atas latar saat ini.`,
        'OK',
        'WARNING'
      );
    }

    const nextSettings = await settings.save({
      themeOverride: { '--color-primary': accentColor },
    });
    store.setState({ settings: nextSettings });
    return;
  }

  await showMessageBox(
    'Input Tidak Valid',
    'Masukkan nomor tema (1-3) atau format: accent=#ff8800',
    'OK',
    'WARNING'
  );
}

function _isLightColor(color) {
  let r, g, b;
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    }
  } else {
    return true; // assume light if can't parse
  }
  // Relative luminance (simplified)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 128;
}

// ─── Simulation UI handlers ────────────────────────────────────────────────

async function _handleStartSimulationPrompt() {
  const cfg = settings.get();
  const today = new Date();
  const dayNames = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const todayDay = dayNames[today.getDay()];

  // Step 1: Ask which day
  const dayOptions = [
    'Pilih hari untuk simulasi:',
    '',
    `0 = Hari ini (${todayDay})`,
    '1 = Besok',
    '2 = Jum\'at berikutnya',
    '3 = Hari spesifik (ketik nama hari)',
    '',
    'Atau langsung ketik: HH:MM [speed]',
    'contoh: 11:55 10',
  ].join('\n');

  const dayRaw = await operator.promptTextEditor({
    title: 'Mulai Simulasi — Pilih Hari',
    hint: dayOptions,
    value: today.getDay() === 5 ? '0' : '2',
    placeholder: '0',
  });

  if (dayRaw === null) return;

  const dayTrimmed = dayRaw.trim();

  // Step 2: Ask for time + speed
  const schedule = _getDisplaySchedule(today);
  const timeOptions = ['Pilih titik mulai:', ''];

  for (const entry of schedule) {
    if (entry.isTimerless) continue;
    const timeStr = `${String(entry.time.getHours()).padStart(2, '0')}:${String(entry.time.getMinutes()).padStart(2, '0')}`;
    timeOptions.push(`${timeStr} ${entry.name}`);
  }

  timeOptions.push('', 'Format: HH:MM [speed]  (contoh: 11:55 10)');

  const timeRaw = await operator.promptTextEditor({
    title: 'Mulai Simulasi — Pilih Waktu',
    hint: timeOptions.join('\n'),
    value: '',
    placeholder: '11:55 10',
  });

  if (timeRaw === null) return;

  const timeTrimmed = timeRaw.trim();
  const timeParts = timeTrimmed.split(/\s+/);

  if (timeParts.length === 0) return;

  // Parse time
  const hmParts = timeParts[0].split(':');
  if (hmParts.length !== 2) {
    await showMessageBox('Format Waktu Salah', 'Gunakan format HH:MM, contoh: 11:55', 'OK', 'WARNING');
    return;
  }

  const hours = Number.parseInt(hmParts[0], 10);
  const minutes = Number.parseInt(hmParts[1], 10);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    await showMessageBox('Waktu Tidak Valid', 'Jam harus 0-23, menit harus 0-59.', 'OK', 'WARNING');
    return;
  }

  // Parse speed
  let speed = 10;
  if (timeParts.length >= 2) {
    const speedNum = Number.parseFloat(timeParts[1]);
    if (Number.isFinite(speedNum) && speedNum > 0) {
      speed = Math.round(speedNum);
    }
  }

  // Build startAt based on day selection
  const startAt = new Date();

  if (dayTrimmed === '0') {
    // Today
    startAt.setHours(hours, minutes, 0, 0);
    if (startAt.getTime() <= Date.now()) {
      startAt.setDate(startAt.getDate() + 1);
    }
  } else if (dayTrimmed === '1') {
    // Tomorrow
    startAt.setDate(startAt.getDate() + 1);
    startAt.setHours(hours, minutes, 0, 0);
  } else if (dayTrimmed === '2') {
    // Next Friday
    const daysUntilFriday = ((5 - startAt.getDay() + 7) % 7) + 7; // next week's Friday
    startAt.setDate(startAt.getDate() + daysUntilFriday);
    startAt.setHours(hours, minutes, 0, 0);
  } else {
    // Try to parse as day name
    const dayMap = { minggu: 0, senin: 1, selasa: 2, rabu: 3, kamis: 4, jumat: 5, sabtu: 6 };
    const input = dayTrimmed.toLowerCase().replace(/[^a-z]/g, '');

    if (dayMap[input] !== undefined) {
      const targetDay = dayMap[input];
      let daysUntil = (targetDay - startAt.getDay() + 7) % 7;
      if (daysUntil === 0) daysUntil = 7; // next week same day
      startAt.setDate(startAt.getDate() + daysUntil);
      startAt.setHours(hours, minutes, 0, 0);
    } else {
      // Try as number (0-6)
      const dayNum = Number.parseInt(dayTrimmed, 10);
      if (Number.isInteger(dayNum) && dayNum >= 0 && dayNum <= 6) {
        let daysUntil = (dayNum - startAt.getDay() + 7) % 7;
        if (daysUntil === 0) daysUntil = 7;
        startAt.setDate(startAt.getDate() + daysUntil);
        startAt.setHours(hours, minutes, 0, 0);
      } else {
        await showMessageBox('Hari Tidak Valid', 'Pilih 0 (hari ini), 1 (besok), 2 (Jum\'at), atau ketik nama hari.', 'OK', 'WARNING');
        return;
      }
    }
  }

  await _handleStartSimulation({ startAt, speed });
}

async function _handleSetSimSpeedPrompt() {
  const raw = await operator.promptTextEditor({
    title: 'Ubah Kecepatan Simulasi',
    hint: [
      'Masukkan pengali kecepatan.',
      '',
      'Contoh:',
      '1x   = real-time',
      '10x  = 10 kali lebih cepat',
      '60x  = 1 menit = 1 detik',
      '300x = 1 menit = 2 detik',
    ].join('\n'),
    value: String(timeController.getSpeed()),
    placeholder: '10',
  });

  if (raw === null) return;

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    await showMessageBox('Nilai Tidak Valid', 'Masukkan angka minimal 1.', 'OK', 'WARNING');
    return;
  }

  await _handleSetSimSpeed(parsed);
}

function _initDevShortcuts() {
  document.addEventListener('keydown', event => {
    if (event.ctrlKey && event.altKey && event.key === 'a') {
      event.preventDefault();
      event.stopPropagation();
      _handleAddSlideshowPhotos().catch(() => {});
    }

    if (event.ctrlKey && event.altKey && event.key === 'm') {
      event.preventDefault();
      event.stopPropagation();
      _handleEditSideMessages().catch(() => {});
    }

    if (event.ctrlKey && event.altKey && event.key === 't') {
      event.preventDefault();
      event.stopPropagation();
      _handleEditTickerMessage().catch(() => {});
    }

    if (event.ctrlKey && event.altKey && event.key === 'd') {
      event.preventDefault();
      event.stopPropagation();
      _handleEditPrayerDurations().catch(() => {});
    }

    if (event.ctrlKey && event.altKey && event.key === 'l') {
      event.preventDefault();
      event.stopPropagation();
      _handleConfigurePrayerLocation().catch(() => {});
    }

    if (event.ctrlKey && event.altKey && event.key === 's') {
      event.preventDefault();
      event.stopPropagation();
      _handleReloadSchedule().catch(() => {});
    }
  });

  window.__dev = Object.assign(window.__dev ?? {}, {
    addSlideshowPhotos: () => _handleAddSlideshowPhotos(),
    editSideMessages: () => _handleEditSideMessages(),
    editTickerMessage: () => _handleEditTickerMessage(),
    editPrayerDurations: () => _handleEditPrayerDurations(),
    editFridayDurations: () => _handleEditFridayDurations(),
    configurePrayerLocation: () => _handleConfigurePrayerLocation(),
    syncPrayerSchedule: () => _handleReloadSchedule(),
    startSim: (opts) => _handleStartSimulation(opts),
    stopSim: () => _handleStopSimulation(),
    setSimSpeed: (n) => _handleSetSimSpeed(n),
  });
}

function _bootFsm(now) {
  let currentPrayer = null;
  let nextPrayer = null;

  try {
    currentPrayer = prayer.getCurrentPrayer(now);
    nextPrayer = prayer.getNextPrayer(now);
  } catch (_) {
    fsm.transition(fsm.STATES.NORMAL);
    return;
  }

  fsm.transition(_resolveFsmState(now, currentPrayer, nextPrayer));
}

async function _loadPrayerRuntime(now = new Date()) {
  const cfg = settings.get();
  await provider.load({ locationId: cfg.prayerLocationId });
  prayer.init(provider, {
    prayerPhaseDurations: cfg.prayerPhaseDurations,
    fridayPrayerDurations: cfg.fridayPrayerDurations,
  });
  store.setState({
    dailySchedule: _getDisplaySchedule(now),
    ..._getScheduleStatusPatch(now),
  });
}

function _getDisplaySchedule(now) {
  if (typeof provider.getDisplaySchedule === 'function') {
    return provider.getDisplaySchedule(now);
  }
  return prayer.getDailySchedule(now);
}

function _getScheduleStatusPatch(now = new Date()) {
  const status = typeof provider.getRuntimeStatus === 'function'
    ? provider.getRuntimeStatus(now)
    : null;

  return {
    scheduleSource: status?.source ?? 'uninitialized',
    scheduleYearsLabel: Array.isArray(status?.cacheYears) ? status.cacheYears.join(', ') : '',
    scheduleLocationLabel: status?.location?.kabko ?? '',
    scheduleHasCacheForDate: Boolean(status?.hasCacheForDate),
  };
}

async function _syncPrayerSchedule({ force = false, silent = false } = {}) {
  if (_syncPromise) return _syncPromise;

  const cfg = settings.get();
  if (!cfg.prayerLocationId) {
    if (!silent) {
      await showMessageBox(
        'Lokasi Belum Diatur',
        'Pilih lokasi jadwal terlebih dahulu dari Panel Operator.',
        'OK',
        'WARNING'
      );
    }
    return false;
  }

  if (!force && !prayerSync.shouldSync(cfg)) {
    return false;
  }

  _syncPromise = (async () => {
    try {
      const result = await prayerSync.syncLocation({
        locationId: cfg.prayerLocationId,
        monthsAhead: cfg.prayerSyncMonthsAhead,
        now: new Date(),
      });

      const nextSettings = await settings.save({
        prayerLocationName: result.locationName ?? cfg.prayerLocationName,
        prayerLocationProvince: result.locationProvince ?? cfg.prayerLocationProvince,
        prayerLastSyncAt: result.syncedAt,
        prayerLastSyncStatus: result.errors.length > 0 ? 'partial' : 'success',
        prayerLastSyncError: result.errors[0] ?? null,
        prayerSyncRangeStart: result.rangeStart,
        prayerSyncRangeEnd: result.rangeEnd,
      });

      store.setState({ settings: nextSettings });
      await _loadPrayerRuntime(new Date());
      _recoverFromErrorIfNeeded();
      _onTick(new Date());

      await log(
        `Sync jadwal selesai: ${result.monthsSynced}/${result.monthsRequested} bulan`,
        result.errors.length > 0 ? 'WARNING' : 'INFO'
      );

      if (!silent) {
        const detail = [
          `Lokasi: ${result.locationName ?? nextSettings.prayerLocationName ?? '-'}`,
          `Rentang: ${result.rangeStart ?? '-'} s.d. ${result.rangeEnd ?? '-'}`,
          `Berhasil: ${result.monthsSynced}/${result.monthsRequested} bulan`,
        ];

        if (result.errors.length > 0) {
          detail.push('', `Sebagian bulan gagal: ${result.errors.length}`);
          detail.push(result.errors.slice(0, 3).join('\n'));
        }

        await showMessageBox(
          'Sinkron Jadwal Selesai',
          detail.join('\n'),
          'OK',
          result.errors.length > 0 ? 'WARNING' : 'INFO'
        );
      }

      return true;
    } catch (error) {
      const nextSettings = await settings.save({
        prayerLastSyncStatus: 'error',
        prayerLastSyncError: error?.message ?? String(error),
      });

      store.setState({ settings: nextSettings });
      await log(`Sync jadwal gagal: ${error?.message ?? error}`, 'ERROR');

      if (!silent) {
        await showMessageBox(
          'Sinkron Jadwal Gagal',
          error?.message ?? String(error),
          'OK',
          'ERROR'
        );
      }

      return false;
    } finally {
      _syncPromise = null;
    }
  })();

  return _syncPromise;
}

function _recoverFromErrorIfNeeded() {
  if (fsm.currentState() !== fsm.STATES.ERROR) return;
  const recovered = fsm.transition(fsm.STATES.BOOT);
  if (recovered) _bootFsm(new Date());
}

function _deriveLocationKeyword(locationName) {
  const safeName = String(locationName ?? 'bogor').trim().toLowerCase();
  return safeName
    .replace(/^kab\.\s*/i, '')
    .replace(/^kota\s*/i, '')
    .trim() || 'bogor';
}

function _normalizeTickerMessage(rawValue) {
  const raw = String(rawValue ?? '').trim();
  if (!raw) return '';

  // Support format: "message1","message2","message3"
  // Split by comma outside quotes, then strip quotes
  const messages = raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map(s => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .map(s => s.slice(0, 280));

  return messages.join('\n').slice(0, 1800);
}

function _formatPrayerPhaseDurations(durations = DEFAULT_PRAYER_PHASE_DURATIONS) {
  return PRAYER_PHASE_KEYS
    .map(prayerKey => {
      const config = durations?.[prayerKey] ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey];
      return [
        prayerKey,
        Number(config.preAzanMinutes ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey].preAzanMinutes),
        Number(config.azanDisplayMinutes ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey].azanDisplayMinutes),
        Number(config.iqomahDelayMinutes ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey].iqomahDelayMinutes),
      ].join('|');
    })
    .join('\n');
}

function _formatFridayPrayerDurations(durations = DEFAULT_FRIDAY_PRAYER_DURATIONS) {
  const config = durations ?? DEFAULT_FRIDAY_PRAYER_DURATIONS;
  return [
    Number(config.preAzanMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.preAzanMinutes),
    Number(config.azanJumatDisplayMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.azanJumatDisplayMinutes),
    Number(config.qabliyahDelayMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.qabliyahDelayMinutes),
    Number(config.azanKhutbahDisplayMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.azanKhutbahDisplayMinutes),
    Number(config.khutbahToIqomahMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.khutbahToIqomahMinutes),
  ].join(' | ');
}

function _parsePrayerPhaseDurations(rawValue, currentValue = DEFAULT_PRAYER_PHASE_DURATIONS) {
  const normalized = {};

  for (const prayerKey of PRAYER_PHASE_KEYS) {
    const fallback = currentValue?.[prayerKey] ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey];
    normalized[prayerKey] = {
      preAzanMinutes: Number(fallback.preAzanMinutes),
      azanDisplayMinutes: Number(fallback.azanDisplayMinutes),
      iqomahDelayMinutes: Number(fallback.iqomahDelayMinutes),
    };
  }

  const lines = String(rawValue ?? '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parts = line.split(/[|;,]/).map(part => part.trim());
    if (parts.length < 4) continue;

    const prayerKey = _normalizePrayerKey(parts[0]);
    if (!PRAYER_PHASE_KEYS.includes(prayerKey)) continue;

    normalized[prayerKey] = {
      preAzanMinutes: _sanitizeMinutes(parts[1], normalized[prayerKey].preAzanMinutes),
      azanDisplayMinutes: _sanitizeMinutes(parts[2], normalized[prayerKey].azanDisplayMinutes),
      iqomahDelayMinutes: _sanitizeMinutes(parts[3], normalized[prayerKey].iqomahDelayMinutes),
    };
  }

  return normalized;
}

function _parseFridayPrayerDurations(rawValue, currentValue = DEFAULT_FRIDAY_PRAYER_DURATIONS) {
  const fallback = currentValue ?? DEFAULT_FRIDAY_PRAYER_DURATIONS;
  const normalized = {
    preAzanMinutes: Number(fallback.preAzanMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.preAzanMinutes),
    azanJumatDisplayMinutes: Number(fallback.azanJumatDisplayMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.azanJumatDisplayMinutes),
    qabliyahDelayMinutes: Number(fallback.qabliyahDelayMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.qabliyahDelayMinutes),
    azanKhutbahDisplayMinutes: Number(fallback.azanKhutbahDisplayMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.azanKhutbahDisplayMinutes),
    khutbahToIqomahMinutes: Number(fallback.khutbahToIqomahMinutes ?? DEFAULT_FRIDAY_PRAYER_DURATIONS.khutbahToIqomahMinutes),
  };

  const parts = String(rawValue ?? '')
    .split(/[|;,]/)
    .map(part => part.trim())
    .filter(Boolean);

  if (parts[0]?.toLowerCase() === 'jumat' || parts[0]?.toLowerCase() === 'jum\'at') {
    parts.shift();
  }

  if (parts.length >= 5) {
    normalized.preAzanMinutes = _sanitizeFridayMinutes(parts[0], normalized.preAzanMinutes);
    normalized.azanJumatDisplayMinutes = _sanitizeFridayMinutes(parts[1], normalized.azanJumatDisplayMinutes);
    normalized.qabliyahDelayMinutes = _sanitizeFridayMinutes(parts[2], normalized.qabliyahDelayMinutes);
    normalized.azanKhutbahDisplayMinutes = _sanitizeFridayMinutes(parts[3], normalized.azanKhutbahDisplayMinutes);
    normalized.khutbahToIqomahMinutes = _sanitizeFridayMinutes(parts[4], normalized.khutbahToIqomahMinutes);
  }

  return normalized;
}

function _normalizePrayerKey(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');

  if (normalized === 'subuh' || normalized === 'shubuh' || normalized === 'fajr') return 'subuh';
  if (normalized === 'dzuhur' || normalized === 'zuhur' || normalized === 'dhuhur') return 'dzuhur';
  if (normalized === 'ashar' || normalized === 'asar') return 'ashar';
  if (normalized === 'maghrib') return 'maghrib';
  if (normalized === 'isya' || normalized === 'isha') return 'isya';

  return normalized;
}

function _sanitizeMinutes(value, fallback) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return Number(fallback);
  return Math.min(60, Math.max(1, Math.round(safeValue)));
}

function _sanitizeFridayMinutes(value, fallback) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return Number(fallback);
  return Math.min(180, Math.max(1, Math.round(safeValue)));
}

function _syncFsmAudioCues(nextState) {
  // During simulation: play audio once per phase transition, not every tick
  if (timeController.isSim()) {
    if (!_simAudioPlayedStates.has(nextState)) {
      _simAudioPlayedStates.add(nextState);

      if (nextState === fsm.STATES.AZAN || nextState === fsm.STATES.FRIDAY_KHUTBAH_AZAN) {
        audioCue.playAzanAlarm()
          .then(success => {
            if (!success) audioCue.playAttentionCue().catch(() => {});
          })
          .catch(() => {
            audioCue.playAttentionCue().catch(() => {});
          });
      }

      if (nextState === fsm.STATES.IQOMAH || nextState === fsm.STATES.FRIDAY_IQOMAH) {
        audioCue.playAzanAlarm()
          .then(success => {
            if (!success) audioCue.playAttentionCue().catch(() => {});
          })
          .catch(() => {
            audioCue.playAttentionCue().catch(() => {});
          });
      }
    }

    _lastObservedFsmState = nextState;
    return;
  }

  // Real mode: play on transition
  if (nextState === fsm.STATES.AZAN && _lastObservedFsmState !== fsm.STATES.AZAN) {
    audioCue.playAzanAlarm()
      .then(success => {
        if (!success) audioCue.playAttentionCue().catch(() => {});
      })
      .catch(() => {
        audioCue.playAttentionCue().catch(() => {});
      });
  }

  if (
    nextState === fsm.STATES.FRIDAY_KHUTBAH_AZAN &&
    _lastObservedFsmState !== fsm.STATES.FRIDAY_KHUTBAH_AZAN
  ) {
    audioCue.playAzanAlarm()
      .then(success => {
        if (!success) audioCue.playAttentionCue().catch(() => {});
      })
      .catch(() => {
        audioCue.playAttentionCue().catch(() => {});
      });
  }

  if (
    _lastObservedFsmState === fsm.STATES.IQOMAH &&
    nextState === fsm.STATES.POST_IQOMAH
  ) {
    audioCue.playAzanAlarm()
      .then(success => {
        if (!success) audioCue.playAttentionCue().catch(() => {});
      })
      .catch(() => {
        audioCue.playAttentionCue().catch(() => {});
      });
  }
  _lastObservedFsmState = nextState;
}

async function _handleOperatorSettingsChanged(nextSettings) {
  store.setState({ settings: nextSettings });
}

function _syncKhutbahSlideshow(fsmState) {
  if (fsmState === fsm.STATES.FRIDAY_KHUTBAH) {
    const cfg = settings.get();
    const khutbahImage = cfg.khutbahImage;
    if (khutbahImage) {
      const imageRef = { sourceType: 'asset', name: khutbahImage, url: `./assets/slideshow/${encodeURIComponent(khutbahImage)}` };
      slideshow.showStatic(imageRef);
    }
  } else {
    if (slideshow.isKhutbahMode()) {
      slideshow.resumeSlideshow();
    }
  }
}

async function onAppReady() {
  const isPrimary = await _checkSingleInstance();
  if (!isPrimary) return;

  try {
    const cfg = await settings.load();
    store.setState({ settings: cfg });

    if (isNeutralinoRuntime) {
      try {
        await writeBundledManifest();
      } catch (error) {
        await log(`Manifest slideshow gagal diperbarui: ${error?.message ?? error}`, 'WARNING');
      }
    }

    await _loadPrayerRuntime(new Date());

    render.init();
    audioCue.init();
    render.applyDisplaySettings(cfg);

    store.subscribe(
      [
        'now',
        'dailySchedule',
        'currentPrayer',
        'nextPrayer',
        'iqomahRemainingMs',
        'isFridayPrayer',
        'fridayPhaseRemainingMs',
        'fridayKhutbahAzanTime',
        'fsmState',
        'settings',
        'scheduleSource',
        'scheduleYearsLabel',
        'scheduleHasCacheForDate',
        'scheduleLocationLabel',
      ],
      render.renderAll
    );

    store.subscribe('settings', state => {
      render.applyDisplaySettings(state.settings);
    });

    store.subscribe('fsmState', state => {
      _syncFsmAudioCues(state.fsmState);
      _syncKhutbahSlideshow(state.fsmState);
    });

    await slideshow.init(cfg.slideshowFolder, cfg.slideshowIntervalMs);
    _applySlideShowFit(cfg.slideshowFit ?? 'cover');
    _applyStripOpacity(cfg.stripBackgroundOpacity ?? 0.35);

    operator.init({
      onAddSlideshowPhotos: _handleAddSlideshowPhotos,
      onEditSideMessages: _handleEditSideMessages,
      onEditTickerMessage: _handleEditTickerMessage,
      onEditPrayerDurations: _handleEditPrayerDurations,
      onEditFridayDurations: _handleEditFridayDurations,
      onConfigurePrayerLocation: _handleConfigurePrayerLocation,
      onReloadSchedule: _handleReloadSchedule,
      onAdjustStripOpacity: _handleAdjustStripOpacity,
      onToggleSlideshowFit: _handleToggleSlideshowFit,
      onConfigureTextScale: _handleConfigureTextScale,
      onConfigureTheme: _handleConfigureTheme,
      onStartSimulation: _handleStartSimulationPrompt,
      onSetSimSpeed: _handleSetSimSpeedPrompt,
      onStopSimulation: _handleStopSimulation,
      onSettingsChanged: _handleOperatorSettingsChanged,
    
      onChangeLogo: _handleChangeLogo,});
    _initDevShortcuts();

    _bootFsm(new Date());
    _onTick(new Date());
    clock.start(_onTick);

    await log('Masjid Signage v0.1.0 - boot selesai', 'INFO');
    _syncPrayerSchedule({ force: false, silent: true }).catch(() => {});
  } catch (error) {
    await log(`Boot error: ${error?.message ?? error}`, 'ERROR');
    fsm.transition(fsm.STATES.ERROR);
  }
}

initRuntime();
onReady(onAppReady);
onWindowClose(async () => {
  clock.stop();
  audioCue.stop();
  await slideshow.stop();
  await _releaseLock();
  // exitProcessOnClose: true in config handles process exit
});

onEvent('masjid.focusWindow', () => {
  focusWindow().catch(() => {});
});

onEvent('masjid.addSlideshowPhotos', () => {
  _handleAddSlideshowPhotos().catch(() => {});
});

onEvent('masjid.editSideMessages', () => {
  _handleEditSideMessages().catch(() => {});
});

onEvent('masjid.editTickerMessage', () => {
  _handleEditTickerMessage().catch(() => {});
});

onEvent('masjid.editPrayerDurations', () => {
  _handleEditPrayerDurations().catch(() => {});
});

onEvent('masjid.configurePrayerLocation', () => {
  _handleConfigurePrayerLocation().catch(() => {});
});

onEvent('masjid.syncPrayerSchedule', () => {
  _handleReloadSchedule().catch(() => {});
});

/**
 * main.js - Bootstrap entry point.
 */

import * as store from './core/store.js';
import * as fsm from './core/fsm.js';
import * as clock from './services/clock.js';
import * as prayer from './services/prayerTimeline.js';
import * as settings from './services/settings.js';
import * as slideshow from './services/slideshow.js';
import * as prayerApi from './services/prayerApi.js';
import * as prayerSync from './services/prayerSync.js';
import * as messageRotator from './services/messageRotator.js';
import * as audioCue from './services/audioCue.js';
import * as provider from './providers/prayerScheduleHybrid.js';
import * as render from './ui/render.js';
import * as operator from './ui/operator.js';
import { syncFitButton } from './ui/operator.js'; // named re-import for convenience
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
  DEFAULT_SIDE_MESSAGE_INTERVAL_MS,
  DEFAULT_PRAYER_PHASE_DURATIONS,
  PRAYER_PHASE_KEYS,
  DEFAULT_SIDE_MESSAGE_TEXT,
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
const OVERLAY_TEST_MODES = Object.freeze({
  PRE_AZAN: 'PRE_AZAN',
  AZAN: 'AZAN',
  IQOMAH: 'IQOMAH',
});

let _heartbeatTimer = null;
let _syncPromise = null;
let _overlayTestMode = null;
let _overlayTestStartTime = null;
let _lastObservedFsmState = fsm.STATES.BOOT;

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

  if (_overlayTestMode) {
    _applyOverlayTestState(now);
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

  if (currentPrayer) {
    iqomahRemainingMs = prayer.getIqomahRemainingMs(now, currentPrayer);
  }

  store.setState({
    now,
    dailySchedule,
    currentPrayer,
    nextPrayer,
    iqomahRemainingMs,
    ..._getScheduleStatusPatch(now),
  });

  _evaluateFsmTransitions(now, currentFsmState, currentPrayer, nextPrayer);
}

function _evaluateFsmTransitions(now, state, currentPrayer, nextPrayer) {
  const targetState = _resolveFsmState(now, currentPrayer, nextPrayer);
  if (targetState !== state) {
    fsm.transition(targetState);
  }
}

function _resolveFsmState(now, currentPrayer, nextPrayer) {
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

async function _handleEditSideMessages() {
  const cfg = settings.get();
  const currentValue = _getPersistedSideMessages(cfg).join('\n');

  const raw = await operator.promptTextEditor({
    title: 'Ubah Pesan Masjid',
    hint: 'Satu baris = satu pesan. Pesan akan berganti otomatis di box kiri.',
    value: currentValue,
    placeholder: DEFAULT_SIDE_MESSAGE_TEXT,
  });

  if (raw === null) return;

  const nextSettings = await settings.save({
    sideMessages: _parseSideMessages(raw),
  });

  store.setState({ settings: nextSettings });
  _syncSideMessageRotator(nextSettings, { reset: true });
}

async function _handleEditTickerMessage() {
  const cfg = settings.get();
  const raw = await operator.promptTextEditor({
    title: 'Ubah Running Text',
    hint: 'Satu baris = satu pesan. Pesan akan berjalan dari kanan ke kiri, lalu pesan berikutnya muncul setelah pesan sebelumnya selesai lewat.',
    value: String(cfg.tickerMessageText ?? ''),
    placeholder: DEFAULT_TICKER_MESSAGE_TEXT,
  });

  if (raw === null) return;

  const nextSettings = await settings.save({
    tickerMessageText: _normalizeTickerMessage(raw),
  });

  store.setState({ settings: nextSettings });
}

async function _handleEditPrayerDurations() {
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

async function _handleTestPreAzan() {
  _overlayTestMode = OVERLAY_TEST_MODES.PRE_AZAN;
  _overlayTestStartTime = new Date();
  _applyOverlayTestState(_overlayTestStartTime);
}

async function _handleTestAzan() {
  _overlayTestMode = OVERLAY_TEST_MODES.AZAN;
  _overlayTestStartTime = new Date();
  _applyOverlayTestState(_overlayTestStartTime);
}

async function _handleTestIqomah() {
  _overlayTestMode = OVERLAY_TEST_MODES.IQOMAH;
  _overlayTestStartTime = new Date();
  _applyOverlayTestState(_overlayTestStartTime);
}

async function _handleClearOverlayTest() {
  _overlayTestMode = null;
  _overlayTestStartTime = null;
  const now = new Date();
  _bootFsm(now);
  _onTick(now);
}

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
    configurePrayerLocation: () => _handleConfigurePrayerLocation(),
    syncPrayerSchedule: () => _handleReloadSchedule(),
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

function _applyOverlayTestState(now) {
  let dailySchedule = [];
  let currentPrayer = null;
  let nextPrayer = null;

  try {
    dailySchedule = _getDisplaySchedule(now);
    currentPrayer = prayer.getCurrentPrayer(now);
    nextPrayer = prayer.getNextPrayer(now);
  } catch (_) {}

  const targetPrayer = _resolveOverlayTestPrayer(now, currentPrayer, nextPrayer, dailySchedule);
  const cfg = settings.get();
  const prayerKey = _normalizePrayerKey(targetPrayer?.name);
  const prayerConfig = cfg?.prayerPhaseDurations?.[prayerKey]
    ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey]
    ?? DEFAULT_PRAYER_PHASE_DURATIONS.dzuhur;

  // Calculate elapsed time since test started
  const elapsedMs = _overlayTestStartTime ? now.getTime() - _overlayTestStartTime.getTime() : 0;

  const patch = {
    now,
    dailySchedule,
    currentPrayer,
    nextPrayer,
    iqomahRemainingMs: 0,
    ..._getScheduleStatusPatch(now),
  };

  if (_overlayTestMode === OVERLAY_TEST_MODES.PRE_AZAN) {
    const preAzanDurationMs = prayerConfig.preAzanMinutes * 60 * 1000;
    const azanDurationMs = prayerConfig.azanDisplayMinutes * 60 * 1000;
    const testPrayerTime = new Date((_overlayTestStartTime ?? now).getTime() + preAzanDurationMs);

    if (elapsedMs < preAzanDurationMs) {
      patch.nextPrayer = {
        name: targetPrayer.name,
        time: testPrayerTime,
      };
      fsm.transition(fsm.STATES.PRE_AZAN);
    } else {
      patch.currentPrayer = {
        name: targetPrayer.name,
        time: testPrayerTime,
      };
      fsm.transition(fsm.STATES.AZAN);

      // Stop this test once azan display duration has passed.
      if (elapsedMs >= preAzanDurationMs + azanDurationMs) {
        _overlayTestMode = null;
        _overlayTestStartTime = null;
      }
    }
  } else if (_overlayTestMode === OVERLAY_TEST_MODES.AZAN) {
    const startTime = _overlayTestStartTime ?? now;
    patch.currentPrayer = {
      name: targetPrayer.name,
      time: startTime,
    };
    fsm.transition(fsm.STATES.AZAN);
  } else if (_overlayTestMode === OVERLAY_TEST_MODES.IQOMAH) {
    const durationMs = prayerConfig.iqomahDelayMinutes * 60 * 1000;
    const remainingMs = Math.max(0, durationMs - elapsedMs);
    patch.currentPrayer = {
      name: targetPrayer.name,
      time: _overlayTestStartTime ?? now,
    };
    patch.iqomahRemainingMs = remainingMs;

    if (remainingMs > 0) {
      fsm.transition(fsm.STATES.IQOMAH);
    } else {
      fsm.transition(fsm.STATES.POST_IQOMAH);
    }
  }

  store.setState(patch);
}

function _resolveOverlayTestPrayer(now, currentPrayer, nextPrayer, dailySchedule) {
  if (nextPrayer?.name && nextPrayer?.time instanceof Date) {
    return {
      name: nextPrayer.name,
      time: nextPrayer.time,
    };
  }

  if (currentPrayer?.name && currentPrayer?.time instanceof Date) {
    return {
      name: currentPrayer.name,
      time: currentPrayer.time,
    };
  }

  const preferredPrayer = (dailySchedule ?? []).find(entry => {
    const key = _normalizePrayerKey(entry?.name);
    return PRAYER_PHASE_KEYS.includes(key) && entry?.time instanceof Date;
  });

  if (preferredPrayer) {
    return {
      name: preferredPrayer.name,
      time: preferredPrayer.time,
    };
  }

  return {
    name: 'Dzuhur',
    time: new Date(now.getTime() + (60 * 60 * 1000)),
  };
}

function _getOverlayTestIqomahRemainingMs(prayerEntry) {
  const prayerKey = _normalizePrayerKey(prayerEntry?.name);
  const cfg = settings.get();
  const prayerConfig = cfg?.prayerPhaseDurations?.[prayerKey]
    ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey]
    ?? DEFAULT_PRAYER_PHASE_DURATIONS.dzuhur;

  return Number(prayerConfig.iqomahDelayMinutes ?? DEFAULT_PRAYER_PHASE_DURATIONS.dzuhur.iqomahDelayMinutes) * 60 * 1000;
}

function _deriveLocationKeyword(locationName) {
  const safeName = String(locationName ?? 'bogor').trim().toLowerCase();
  return safeName
    .replace(/^kab\.\s*/i, '')
    .replace(/^kota\s*/i, '')
    .trim() || 'bogor';
}

function _parseSideMessages(rawValue) {
  const messages = String(rawValue ?? '')
    .split(/\r?\n/)
    .map(message => message.trim())
    .filter(Boolean)
    .map(message => message.slice(0, 280));

  return messages;
}

function _getPersistedSideMessages(cfg) {
  const messages = Array.isArray(cfg?.sideMessages)
    ? cfg.sideMessages
        .map(message => String(message ?? '').trim())
        .filter(Boolean)
    : [];

  return messages.length > 0 ? messages : [DEFAULT_SIDE_MESSAGE_TEXT];
}

function _normalizeTickerMessage(rawValue) {
  const lines = String(rawValue ?? '')
    .split(/\r?\n/)
    .map(message => message.trim())
    .filter(Boolean)
    .map(message => message.slice(0, 280));

  return lines.join('\n').slice(0, 1800);
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

function _syncSideMessageRotator(cfg, options = {}) {
  const messages = _getPersistedSideMessages(cfg);

  messageRotator.update(
    {
      messages,
      intervalMs: Number(cfg?.sideMessageIntervalMs ?? DEFAULT_SIDE_MESSAGE_INTERVAL_MS),
    },
    { reset: options.reset === true }
  );
}

function _syncSideMessageRotationState(fsmState) {
  if (
    fsmState === fsm.STATES.PRE_AZAN ||
    fsmState === fsm.STATES.AZAN ||
    fsmState === fsm.STATES.IQOMAH
  ) {
    messageRotator.pause();
    return;
  }

  messageRotator.resume();
}

function _syncFsmAudioCues(nextState) {
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

    messageRotator.init({
      messages: _getPersistedSideMessages(cfg),
      intervalMs: Number(cfg.sideMessageIntervalMs ?? DEFAULT_SIDE_MESSAGE_INTERVAL_MS),
      onChange: message => {
        store.setState({ activeSideMessage: message });
      },
    });

    await _loadPrayerRuntime(new Date());

    render.init();
    audioCue.init();

    store.subscribe(
      [
        'now',
        'dailySchedule',
        'currentPrayer',
        'nextPrayer',
        'iqomahRemainingMs',
        'fsmState',
        'settings',
        'activeSideMessage',
        'scheduleSource',
        'scheduleYearsLabel',
        'scheduleLocationLabel',
        'scheduleHasCacheForDate',
      ],
      render.renderAll
    );

    store.subscribe('fsmState', state => {
      _syncSideMessageRotationState(state.fsmState);
      _syncFsmAudioCues(state.fsmState);
    });

    await slideshow.init(cfg.slideshowFolder, cfg.slideshowIntervalMs);
    _applySlideShowFit(cfg.slideshowFit ?? 'cover');
    _applyStripOpacity(cfg.stripBackgroundOpacity ?? 0.35);

    operator.init({
      onAddSlideshowPhotos: _handleAddSlideshowPhotos,
      onEditSideMessages: _handleEditSideMessages,
      onEditTickerMessage: _handleEditTickerMessage,
      onEditPrayerDurations: _handleEditPrayerDurations,
      onTestPreAzan: _handleTestPreAzan,
      onTestAzan: _handleTestAzan,
      onTestIqomah: _handleTestIqomah,
      onClearOverlayTest: _handleClearOverlayTest,
      onConfigurePrayerLocation: _handleConfigurePrayerLocation,
      onReloadSchedule: _handleReloadSchedule,
      onAdjustStripOpacity: _handleAdjustStripOpacity,
      onToggleSlideshowFit: _handleToggleSlideshowFit,
    });
    _initDevShortcuts();

    _bootFsm(new Date());
    _syncSideMessageRotationState(fsm.currentState());
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
  messageRotator.stop();
  await slideshow.stop();
  await _releaseLock();
  await exitApp();
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

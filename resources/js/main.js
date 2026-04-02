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
import * as provider from './providers/prayerScheduleHybrid.js';
import * as render from './ui/render.js';
import * as operator from './ui/operator.js';
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

const INSTANCE_LOCK_KEY = 'masjid_instance_lock';
const LOCK_HEARTBEAT_MS = 2000;
const LOCK_STALE_MS = 5000;
const OVERLAY_TEST_MODES = Object.freeze({
  PRE_AZAN: 'PRE_AZAN',
  AZAN: 'AZAN',
  IQOMAH: 'IQOMAH',
});
const TEST_IQOMAH_REMAINING_MS = 5 * 60 * 1000;

let _heartbeatTimer = null;
let _syncPromise = null;
let _overlayTestMode = null;

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

async function _handleChooseFolder() {
  const newPath = await settings.chooseFolder();
  if (!newPath) return;

  const cfg = settings.get();
  await slideshow.init(newPath, cfg.slideshowIntervalMs);
  store.setState({ settings: cfg });
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
      'nama | countdown azan | lama azan | countdown iqomah',
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
  _applyOverlayTestState(new Date());
}

async function _handleTestAzan() {
  _overlayTestMode = OVERLAY_TEST_MODES.AZAN;
  _applyOverlayTestState(new Date());
}

async function _handleTestIqomah() {
  _overlayTestMode = OVERLAY_TEST_MODES.IQOMAH;
  _applyOverlayTestState(new Date());
}

async function _handleClearOverlayTest() {
  _overlayTestMode = null;
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
    if (event.ctrlKey && event.altKey && event.key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      _handleChooseFolder().catch(() => {});
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
    chooseFolder: () => _handleChooseFolder(),
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
  const patch = {
    now,
    dailySchedule,
    currentPrayer,
    nextPrayer,
    iqomahRemainingMs: 0,
    ..._getScheduleStatusPatch(now),
  };

  if (_overlayTestMode === OVERLAY_TEST_MODES.PRE_AZAN) {
    patch.nextPrayer = targetPrayer;
    fsm.transition(fsm.STATES.PRE_AZAN);
  } else if (_overlayTestMode === OVERLAY_TEST_MODES.AZAN) {
    patch.currentPrayer = targetPrayer;
    fsm.transition(fsm.STATES.AZAN);
  } else if (_overlayTestMode === OVERLAY_TEST_MODES.IQOMAH) {
    patch.currentPrayer = targetPrayer;
    patch.iqomahRemainingMs = TEST_IQOMAH_REMAINING_MS;
    fsm.transition(fsm.STATES.IQOMAH);
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

async function onAppReady() {
  const isPrimary = await _checkSingleInstance();
  if (!isPrimary) return;

  try {
    const cfg = await settings.load();
    store.setState({ settings: cfg });

    messageRotator.init({
      messages: _getPersistedSideMessages(cfg),
      intervalMs: Number(cfg.sideMessageIntervalMs ?? DEFAULT_SIDE_MESSAGE_INTERVAL_MS),
      onChange: message => {
        store.setState({ activeSideMessage: message });
      },
    });

    await _loadPrayerRuntime(new Date());

    render.init();

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
    });

    await slideshow.init(cfg.slideshowFolder, cfg.slideshowIntervalMs);

    operator.init({
      onChooseFolder: _handleChooseFolder,
      onEditSideMessages: _handleEditSideMessages,
      onEditTickerMessage: _handleEditTickerMessage,
      onEditPrayerDurations: _handleEditPrayerDurations,
      onTestPreAzan: _handleTestPreAzan,
      onTestAzan: _handleTestAzan,
      onTestIqomah: _handleTestIqomah,
      onClearOverlayTest: _handleClearOverlayTest,
      onConfigurePrayerLocation: _handleConfigurePrayerLocation,
      onReloadSchedule: _handleReloadSchedule,
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
  messageRotator.stop();
  await slideshow.stop();
  await _releaseLock();
  await exitApp();
});

onEvent('masjid.focusWindow', () => {
  focusWindow().catch(() => {});
});

onEvent('masjid.chooseFolder', () => {
  _handleChooseFolder().catch(() => {});
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

/**
 * services/settings.js
 */

import {
  DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH,
  normalizeSlideshowFolder,
} from './slideshowLibrary.js';
import { storageGet, storageSet } from './platform.js';

const SETTINGS_KEY = 'masjid_settings';

export const PRAYER_PHASE_KEYS = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'];
export const DEFAULT_PRAYER_PHASE_DURATIONS = Object.freeze({
  subuh: Object.freeze({ preAzanMinutes: 5, azanDisplayMinutes: 3, iqomahDelayMinutes: 10 }),
  dzuhur: Object.freeze({ preAzanMinutes: 5, azanDisplayMinutes: 3, iqomahDelayMinutes: 8 }),
  ashar: Object.freeze({ preAzanMinutes: 5, azanDisplayMinutes: 3, iqomahDelayMinutes: 8 }),
  maghrib: Object.freeze({ preAzanMinutes: 5, azanDisplayMinutes: 3, iqomahDelayMinutes: 5 }),
  isya: Object.freeze({ preAzanMinutes: 5, azanDisplayMinutes: 3, iqomahDelayMinutes: 10 }),
});

export const DEFAULT_SIDE_MESSAGE_TEXT =
  'Perbanyak dzikir, rapatkan shaf, dan persiapkan diri menyambut waktu sholat dengan tenang.';
export const DEFAULT_TICKER_MESSAGE_TEXT =
  'Mari jaga kekhusyukan masjid, rapikan sandal, dan siapkan diri menyambut jamaah berikutnya.';
export const DEFAULT_SIDE_MESSAGE_INTERVAL_MS = 10000;

const DEFAULTS = Object.freeze({
  slideshowFolder: DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH,
  slideshowIntervalMs: 8000,
  slideshowFit: 'cover',
  preAzanWarningMinutes: 5,
  azanDisplayMinutes: 3,
  iqomahDelayMinutes: 10,
  prayerPhaseDurations: DEFAULT_PRAYER_PHASE_DURATIONS,
  prayerLocationId: '7e7757b1e12abcb736ab9a754ffb617a',
  prayerLocationName: 'KAB. BOGOR',
  prayerLocationProvince: 'JAWA BARAT',
  prayerSyncMonthsAhead: 12,
  prayerLastSyncAt: null,
  prayerLastSyncStatus: 'never',
  prayerLastSyncError: null,
  prayerSyncRangeStart: null,
  prayerSyncRangeEnd: null,
  sideMessages: [DEFAULT_SIDE_MESSAGE_TEXT],
  sideMessageIntervalMs: DEFAULT_SIDE_MESSAGE_INTERVAL_MS,
  tickerMessageText: DEFAULT_TICKER_MESSAGE_TEXT,
});

let _settings = { ...DEFAULTS };

export async function load() {
  try {
    const raw = await storageGet(SETTINGS_KEY);
    _settings = _normalizeSettings(Object.assign({}, DEFAULTS, JSON.parse(raw)));
  } catch (_) {
    _settings = _normalizeSettings({ ...DEFAULTS });
  }
  return get();
}

export async function save(patch) {
  _settings = _normalizeSettings(Object.assign({}, _settings, patch));
  await storageSet(SETTINGS_KEY, JSON.stringify(_settings));
  return get();
}

export function get() {
  return _normalizeSettings(Object.assign({}, _settings));
}

function _normalizeSettings(value) {
  const legacy = {
    preAzanMinutes: value?.preAzanWarningMinutes,
    azanDisplayMinutes: value?.azanDisplayMinutes,
    iqomahDelayMinutes: value?.iqomahDelayMinutes,
  };

  return Object.assign({}, DEFAULTS, value, {
    slideshowFolder: normalizeSlideshowFolder(value?.slideshowFolder),
    prayerPhaseDurations: _normalizePrayerPhaseDurations(value?.prayerPhaseDurations, legacy),
  });
}

function _normalizePrayerPhaseDurations(rawValue, legacy = {}) {
  const normalized = {};

  for (const prayerKey of PRAYER_PHASE_KEYS) {
    const source = rawValue?.[prayerKey] ?? {};
    const fallback = DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey];

    normalized[prayerKey] = {
      preAzanMinutes: _sanitizeMinutes(
        source.preAzanMinutes,
        legacy.preAzanMinutes ?? fallback.preAzanMinutes
      ),
      azanDisplayMinutes: _sanitizeMinutes(
        source.azanDisplayMinutes,
        legacy.azanDisplayMinutes ?? fallback.azanDisplayMinutes
      ),
      iqomahDelayMinutes: _sanitizeMinutes(
        source.iqomahDelayMinutes,
        legacy.iqomahDelayMinutes ?? fallback.iqomahDelayMinutes
      ),
    };
  }

  return normalized;
}

function _sanitizeMinutes(value, fallback) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return Number(fallback);
  return Math.min(60, Math.max(1, Math.round(safeValue)));
}

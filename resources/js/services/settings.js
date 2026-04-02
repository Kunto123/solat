/**
 * services/settings.js
 */

import {
  isNeutralinoRuntime,
  log,
  showMessageBox,
  storageGet,
  storageSet,
} from './platform.js';
import * as browserImageStore from './browserImageStore.js';

const SETTINGS_KEY = 'masjid_settings';
const WEB_SLIDESHOW_SOURCE = 'browser://slideshow';

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
  slideshowFolder: null,
  slideshowIntervalMs: 8000,
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

export async function validateFolder(folderPath) {
  if (!isNeutralinoRuntime) {
    return {
      valid: typeof folderPath === 'string' && folderPath.startsWith(WEB_SLIDESHOW_SOURCE),
      absPath: folderPath ?? WEB_SLIDESHOW_SOURCE,
      error: 'Mode web tidak menggunakan akses folder lokal langsung',
    };
  }

  if (!folderPath || folderPath.trim() === '') {
    return { valid: false, error: 'Path tidak boleh kosong' };
  }

  let absPath;
  try {
    absPath = await Neutralino.filesystem.getAbsolutePath(folderPath);
  } catch (_) {
    return { valid: false, error: `Path tidak dapat di-resolve: ${folderPath}` };
  }

  let stats;
  try {
    stats = await Neutralino.filesystem.getStats(absPath);
  } catch (_) {
    return { valid: false, error: `Folder tidak ditemukan atau tidak dapat diakses: ${absPath}` };
  }

  if (!stats.isDirectory) {
    return { valid: false, error: `Path bukan folder: ${absPath}` };
  }

  return { valid: true, absPath };
}

export async function chooseFolder() {
  if (!isNeutralinoRuntime) {
    const files = await browserImageStore.pickImages();
    if (!files || files.length === 0) {
      await showMessageBox(
        'Folder Gambar Kosong',
        'Tidak ada gambar yang berhasil dibaca dari folder atau pilihan dibatalkan.',
        'OK',
        'WARNING'
      );
      return null;
    }

    const count = await browserImageStore.replaceImages(files);
    await save({ slideshowFolder: WEB_SLIDESHOW_SOURCE });
    await log(`Settings: ${count} gambar slideshow web disimpan`, 'INFO');
    await showMessageBox(
      'Gambar Slideshow Disimpan',
      `${count} gambar berhasil dibaca dari folder dan disimpan ke browser.`,
      'OK',
      'INFO'
    );
    return WEB_SLIDESHOW_SOURCE;
  }

  let selected;
  try {
    selected = await Neutralino.os.showFolderDialog('Pilih folder gambar slideshow');
  } catch (_) {
    return null;
  }

  if (!selected) return null;

  const result = await validateFolder(selected);
  if (!result.valid) {
    await showMessageBox(
      'Folder Tidak Valid',
      result.error ?? 'Folder tidak dapat digunakan.',
      'OK',
      'ERROR'
    );
    return null;
  }

  await save({ slideshowFolder: result.absPath });
  await log(`Settings: folder slideshow disimpan -> ${result.absPath}`, 'INFO');
  return result.absPath;
}

function _normalizeSettings(value) {
  const legacy = {
    preAzanMinutes: value?.preAzanWarningMinutes,
    azanDisplayMinutes: value?.azanDisplayMinutes,
    iqomahDelayMinutes: value?.iqomahDelayMinutes,
  };

  return Object.assign({}, DEFAULTS, value, {
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

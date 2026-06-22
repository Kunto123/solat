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
export const DEFAULT_FRIDAY_PRAYER_DURATIONS = Object.freeze({
  preAzanMinutes: 5,
  azanJumatDisplayMinutes: 3,
  qabliyahDelayMinutes: 2,
  azanKhutbahDisplayMinutes: 2,
  khutbahToIqomahMinutes: 30,
});

export const DEFAULT_SIDE_MESSAGE_TEXT =
  'Perbanyak dzikir, rapatkan shaf, dan persiapkan diri menyambut waktu sholat dengan tenang.';
export const DEFAULT_TICKER_MESSAGE_TEXT =
  'Mari jaga kekhusyukan masjid, rapikan sandal, dan siapkan diri menyambut jamaah berikutnya.';
export const DEFAULT_SIDE_MESSAGE_INTERVAL_MS = 10000;

// ── Theme presets ──────────────────────────────────────────────────────────

export const THEME_PRESETS = Object.freeze({
  navy: Object.freeze({
    '--color-primary': '#002263',
    '--color-primary-strong': '#173572',
    '--color-primary-soft': 'rgba(23, 53, 114, 0.24)',
    '--color-bg': '#031230',
    '--color-panel': 'rgba(0, 34, 99, 0.34)',
    '--color-surface': '#002263',
    '--color-surface-muted': '#173572',
    '--color-text': '#edf5ff',
    '--color-text-soft': '#d2def5',
    '--color-ink-dark': '#173353',
    '--color-border': 'rgba(196, 223, 255, 0.14)',
    '--color-shadow': 'rgba(2, 9, 24, 0.42)',
    '--color-success': '#1ea36b',
    '--color-warning': '#f0a23b',
    '--color-danger': '#d75b5b',
    '--strip-bg-tint': 'rgba(4, 16, 36, 0.35)',
    '--strip-border': 'rgba(150, 180, 220, 0.26)',
    '--accent-current-bg': 'linear-gradient(180deg, rgba(220, 145, 82, 0.32) 0%, rgba(200, 120, 60, 0.22) 100%)',
    '--accent-next-bg': 'linear-gradient(180deg, rgba(95, 175, 195, 0.30) 0%, rgba(70, 155, 178, 0.18) 100%)',
    '--font-primary': '"Goudy Old Style", "Palatino Linotype", "Book Antiqua", "Constantia", "Georgia", serif',
  }),
  hijau: Object.freeze({
    '--color-primary': '#0a4d2e',
    '--color-primary-strong': '#146b3a',
    '--color-primary-soft': 'rgba(20, 107, 58, 0.24)',
    '--color-bg': '#041a0e',
    '--color-panel': 'rgba(10, 77, 46, 0.34)',
    '--color-surface': '#0a4d2e',
    '--color-surface-muted': '#146b3a',
    '--color-text': '#e8f5ee',
    '--color-text-soft': '#c5e0d0',
    '--color-ink-dark': '#1a3d28',
    '--color-border': 'rgba(160, 220, 180, 0.14)',
    '--color-shadow': 'rgba(2, 15, 8, 0.42)',
    '--color-success': '#1ea36b',
    '--color-warning': '#f0a23b',
    '--color-danger': '#d75b5b',
    '--strip-bg-tint': 'rgba(4, 30, 16, 0.35)',
    '--strip-border': 'rgba(120, 200, 150, 0.26)',
    '--accent-current-bg': 'linear-gradient(180deg, rgba(180, 200, 100, 0.32) 0%, rgba(140, 180, 80, 0.22) 100%)',
    '--accent-next-bg': 'linear-gradient(180deg, rgba(80, 180, 140, 0.30) 0%, rgba(60, 150, 120, 0.18) 100%)',
    '--font-primary': '"Goudy Old Style", "Palatino Linotype", "Book Antiqua", "Constantia", "Georgia", serif',
  }),
  gelap: Object.freeze({
    '--color-primary': '#1a1a2e',
    '--color-primary-strong': '#2a2a4a',
    '--color-primary-soft': 'rgba(42, 42, 74, 0.24)',
    '--color-bg': '#0d0d1a',
    '--color-panel': 'rgba(26, 26, 46, 0.34)',
    '--color-surface': '#1a1a2e',
    '--color-surface-muted': '#2a2a4a',
    '--color-text': '#e8e8f0',
    '--color-text-soft': '#b8b8d0',
    '--color-ink-dark': '#2a2a3e',
    '--color-border': 'rgba(150, 150, 200, 0.14)',
    '--color-shadow': 'rgba(5, 5, 15, 0.42)',
    '--color-success': '#1ea36b',
    '--color-warning': '#f0a23b',
    '--color-danger': '#d75b5b',
    '--strip-bg-tint': 'rgba(10, 10, 25, 0.45)',
    '--strip-border': 'rgba(100, 100, 180, 0.26)',
    '--accent-current-bg': 'linear-gradient(180deg, rgba(200, 160, 80, 0.32) 0%, rgba(180, 140, 60, 0.22) 100%)',
    '--accent-next-bg': 'linear-gradient(180deg, rgba(120, 120, 200, 0.30) 0%, rgba(100, 100, 180, 0.18) 100%)',
    '--font-primary': '"Goudy Old Style", "Palatino Linotype", "Book Antiqua", "Constantia", "Georgia", serif',
  }),
});

export const THEME_PRESET_KEYS = Object.keys(THEME_PRESETS);

const ALLOWED_OVERRIDE_KEYS = new Set([
  '--color-primary',
  '--color-bg',
  '--color-text',
  '--font-primary',
]);

const CURATED_FONTS = new Set([
  '"Goudy Old Style", "Palatino Linotype", "Book Antiqua", "Constantia", "Georgia", serif',
  '"Palatino Linotype", "Book Antiqua", "Constantia", "Georgia", serif',
  '"Book Antiqua", "Constantia", "Georgia", "Palatino Linotype", serif',
  '"Trebuchet MS", "Segoe UI", system-ui, sans-serif',
  '"Segoe UI", "Trebuchet MS", system-ui, sans-serif',
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  '"Georgia", "Times New Roman", serif',
  '"Times New Roman", "Georgia", serif',
]);

// ── Custom text defaults ───────────────────────────────────────────────────

export const CUSTOM_TEXT_DEFAULTS = Object.freeze({
  focusMenujuAdzan: { text: 'Menuju Adzan', size: '32px', color: '', font: '' },
  focusMenujuAzanJumat: { text: 'Menuju Azan Jumat', size: '32px', color: '', font: '' },
  focusWaktuAdzan: { text: 'Waktu Adzan', size: '32px', color: '', font: '' },
  focusWaktuAzanJumat: { text: 'Waktu Azan Jumat', size: '32px', color: '', font: '' },
  focusIqomah: { text: 'Iqomah', size: '32px', color: '', font: '' },
  focusPukul: { text: 'Pukul', size: '36px', color: '', font: '' },
  focusJedaQabliyah: { text: 'Jeda Shalat Qabliyah', size: '32px', color: '', font: '' },
  focusAzanKhutbah: { text: 'Azan Khutbah', size: '64px', color: '', font: '' },
  focusWaktuAzanKhutbah: { text: 'Waktu Azan Khutbah', size: '32px', color: '', font: '' },
  focusIqomahJumat: { text: 'Iqomah Jumat', size: '32px', color: '', font: '' },
  focusAzanKhutbahName: { text: 'Azan Khutbah', size: '24px', color: '', font: '' },
  prayerLabelImsak: { text: 'Imsak', size: '48px', color: '', font: '' },
  prayerLabelSubuh: { text: 'Subuh', size: '48px', color: '', font: '' },
  prayerLabelSyuruq: { text: 'Syuruq', size: '48px', color: '', font: '' },
  prayerLabelDzuhur: { text: 'Zuhur', size: '48px', color: '', font: '' },
  prayerLabelJumat: { text: 'Jumat', size: '48px', color: '', font: '' },
  prayerLabelAshar: { text: 'Ashar', size: '48px', color: '', font: '' },
  prayerLabelMaghrib: { text: 'Magrib', size: '48px', color: '', font: '' },
  prayerLabelIsya: { text: 'Isya', size: '48px', color: '', font: '' },
  heroIqomahPrefix: { text: 'Iqomah', size: '24px', color: '', font: '' },
  simBannerLabel: { text: 'MODE SIMULASI', size: '16px', color: '', font: '' },
});

export const CUSTOM_TEXT_KEYS = Object.keys(CUSTOM_TEXT_DEFAULTS);

const DEFAULTS = Object.freeze({
  slideshowFolder: DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH,
  slideshowIntervalMs: 8000,
  slideshowFit: 'cover',
  preAzanWarningMinutes: 5,
  azanDisplayMinutes: 3,
  iqomahDelayMinutes: 10,
  prayerPhaseDurations: DEFAULT_PRAYER_PHASE_DURATIONS,
  fridayPrayerDurations: DEFAULT_FRIDAY_PRAYER_DURATIONS,
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
  stripBackgroundOpacity: 0.35,
  // ── Identity ──
  masjidName: 'Masjid An-Nur',
  masjidAddress: 'PT. ASKI Jl. Mayor Oking Jayaatmaja, Karang Asem Barat, Kec. Citeureup, Kabupaten Bogor',
  logoPath: 'assets/fallback/logo-masjid.png',
  // ── Text sizing ──
  textScale: 1.0,
  // ── Theme ──
  themePreset: 'navy',
  themeOverride: {},
  // ── Custom text ──
  customText: CUSTOM_TEXT_DEFAULTS,
  // ── Khutbah ──
  khutbahImage: null,
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
    fridayPrayerDurations: _normalizeFridayPrayerDurations(value?.fridayPrayerDurations),
    masjidName: _sanitizeString(value?.masjidName, DEFAULTS.masjidName),
    masjidAddress: _sanitizeString(value?.masjidAddress, DEFAULTS.masjidAddress),
    logoPath: _sanitizeString(value?.logoPath, DEFAULTS.logoPath),
    textScale: _sanitizeTextScale(value?.textScale),
    themePreset: _sanitizeThemePreset(value?.themePreset),
    themeOverride: _normalizeThemeOverride(value?.themeOverride),
    customText: _normalizeCustomText(value?.customText),
    khutbahImage: _sanitizeStringOrNull(value?.khutbahImage),
  });
}

function _sanitizeString(value, fallback) {
  const str = String(value ?? '').trim();
  return str.length > 0 ? str : fallback;
}

function _sanitizeTextScale(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 1.0;
  return Math.min(1.4, Math.max(0.7, num));
}

function _sanitizeThemePreset(value) {
  const str = String(value ?? '').trim().toLowerCase();
  return THEME_PRESET_KEYS.includes(str) ? str : 'navy';
}

function _normalizeThemeOverride(value) {
  if (!value || typeof value !== 'object') return {};

  const normalized = {};
  for (const [key, val] of Object.entries(value)) {
    if (!ALLOWED_OVERRIDE_KEYS.has(key)) continue;

    if (key === '--font-primary') {
      const str = String(val ?? '').trim();
      if (str.length > 0 && (CURATED_FONTS.has(str) || str.includes('sans-serif') || str.includes('serif'))) {
        normalized[key] = str;
      }
    } else {
      // Validate hex color
      const str = String(val ?? '').trim();
      if (/^#[0-9a-fA-F]{3,8}$/.test(str)) {
        normalized[key] = str;
      }
    }
  }

  return normalized;
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

function _normalizeFridayPrayerDurations(rawValue = {}) {
  return {
    preAzanMinutes: _sanitizeFridayMinutes(rawValue.preAzanMinutes, DEFAULT_FRIDAY_PRAYER_DURATIONS.preAzanMinutes),
    azanJumatDisplayMinutes: _sanitizeFridayMinutes(rawValue.azanJumatDisplayMinutes, DEFAULT_FRIDAY_PRAYER_DURATIONS.azanJumatDisplayMinutes),
    qabliyahDelayMinutes: _sanitizeFridayMinutes(rawValue.qabliyahDelayMinutes, DEFAULT_FRIDAY_PRAYER_DURATIONS.qabliyahDelayMinutes),
    azanKhutbahDisplayMinutes: _sanitizeFridayMinutes(rawValue.azanKhutbahDisplayMinutes, DEFAULT_FRIDAY_PRAYER_DURATIONS.azanKhutbahDisplayMinutes),
    khutbahToIqomahMinutes: _sanitizeFridayMinutes(rawValue.khutbahToIqomahMinutes, DEFAULT_FRIDAY_PRAYER_DURATIONS.khutbahToIqomahMinutes),
  };
}

function _sanitizeFridayMinutes(value, fallback) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return Number(fallback);
  return Math.min(180, Math.max(1, Math.round(safeValue)));
}

function _normalizeCustomText(rawValue) {
  const normalized = {};
  for (const key of CUSTOM_TEXT_KEYS) {
    normalized[key] = { ...CUSTOM_TEXT_DEFAULTS[key] };
  }
  if (rawValue && typeof rawValue === 'object') {
    for (const key of CUSTOM_TEXT_KEYS) {
      const entry = rawValue[key];
      if (entry && typeof entry === 'object' && entry.text !== undefined) {
        // New format: { text, size, color, font }
        const text = String(entry.text ?? '').trim();
        if (text.length > 0) {
          normalized[key] = {
            text,
            size: _sanitizeCssSize(entry.size, CUSTOM_TEXT_DEFAULTS[key].size),
            color: _sanitizeColor(entry.color),
            font: _sanitizeFont(entry.font),
          };
        }
      } else if (typeof entry === 'string' && entry.trim().length > 0) {
        // Old format migration: plain string -> object with custom text, default styles
        normalized[key] = {
          text: entry.trim(),
          size: CUSTOM_TEXT_DEFAULTS[key].size,
          color: '',
          font: '',
        };
      }
    }
  }
  return normalized;
}

function _sanitizeCssSize(value, fallback) {
  const str = String(value ?? '').trim();
  if (!str) return fallback;
  // Allow px, rem, vw, plain number, etc.
  if (/^[0-9.]+[a-z%]*$/.test(str)) {
    return str;
  }
  return fallback;
}

function _sanitizeColor(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  // Allow hex, rgb, rgba, hsl, or named colors
  if (/^#[0-9a-fA-F]{3,8}$/.test(str) || /^rgb/i.test(str) || /^hsl/i.test(str)) {
    return str;
  }
  return '';
}

function _sanitizeFont(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  // Basic validation: must contain letters
  if (/[a-zA-Z]/.test(str)) {
    return str;
  }
  return '';
}

function _sanitizeStringOrNull(value) {
  const str = String(value ?? '').trim();
  return str.length > 0 ? str : null;
}

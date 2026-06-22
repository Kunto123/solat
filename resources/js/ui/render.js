/**
 * ui/render.js - DOM update functions
 */

import {
  DEFAULT_TICKER_MESSAGE_TEXT,
  THEME_PRESETS,
  CUSTOM_TEXT_DEFAULTS,
} from '../services/settings.js';
import { isSim, getSpeed } from '../services/timeController.js';

const PRAYER_CARD_ALIASES = {
  imsak: ['imsak'],
  subuh: ['subuh', 'shubuh', 'fajr'],
  syuruq: ['syuruq', 'syuruk', 'sunrise', 'terbit'],
  dzuhur: ['dzuhur', 'zuhur', 'zuhur', 'dhuhur'],
  ashar: ['ashar', 'asar'],
  maghrib: ['maghrib'],
  isya: ['isya', 'isha'],
};

const TICKER_TRAVEL_PX_PER_SECOND = 118;
const TICKER_MIN_DURATION_MS = 7000;
const TICKER_GAP_MS = 320;

const _textSwapTimers = new WeakMap();

let _els = {};
let _lastDateKey = '';
let _tickerMessages = [DEFAULT_TICKER_MESSAGE_TEXT];
let _tickerSignature = '';
let _tickerIndex = 0;
let _tickerTimer = null;
let _tickerRafA = 0;
let _tickerRafB = 0;
let _tickerResizeBound = false;
let _tickerResizeTimer = null;

export function init() {
  _els = {
    clock: document.getElementById('clock'),
    dateGregorian: document.getElementById('date-gregorian'),
    dateHijri: document.getElementById('date-hijri'),
    focusOverlay: document.getElementById('focus-overlay'),
    focusOverlayLabel: document.getElementById('focus-overlay-label'),
    focusOverlayPrayer: document.getElementById('focus-overlay-prayer'),
    focusOverlayPrimary: document.getElementById('focus-overlay-primary'),
    focusOverlaySecondary: document.getElementById('focus-overlay-secondary'),
    focusOverlaySecondaryLabel: document.getElementById('focus-overlay-secondary-label'),
    focusOverlaySecondaryTime: document.getElementById('focus-overlay-secondary-time'),
    nextPrayerSummary: document.getElementById('next-prayer-summary'),
    nextPrayerCountdown: document.getElementById('next-prayer-countdown'),
    nextPrayerTime: document.getElementById('next-prayer-time'),
    iqomahCountdown: document.getElementById('iqomah-countdown'),
    tickerViewport: document.getElementById('ticker-viewport'),
    tickerTrack: document.getElementById('ticker-track'),
    tickerText: document.getElementById('ticker-text'),
    opStatusText: document.getElementById('op-status-text'),
    masjidName: document.getElementById('masjid-name'),
    masjidAddress: document.getElementById('masjid-address'),
    masjidLogo: document.getElementById('masjid-logo'),
    simBanner: document.getElementById('sim-banner'),
    simBannerTime: document.getElementById('sim-banner-time'),
    simBannerSpeed: document.getElementById('sim-banner-speed'),
    simBannerFase: document.getElementById('sim-banner-fase'),
    errorOverlay: document.getElementById('error-overlay'),
    errorMessage: document.getElementById('error-message'),
    prayerCards: Array.from(document.querySelectorAll('.prayer-card')),
  };

  if (!_tickerResizeBound) {
    window.addEventListener('resize', _handleTickerResize);
    _tickerResizeBound = true;
  }
}

function _setText(el, text) {
  if (!el || el.textContent === text) return;
  el.textContent = text;
}

function _setHidden(el, hidden) {
  if (!el || el.hidden === hidden) return;
  el.hidden = hidden;
}

function _setDataAttr(el, key, value) {
  if (!el || el.dataset[key] === value) return;
  el.dataset[key] = value;
}

function _swapTextWithFade(el, text) {
  if (!el || el.textContent === text) return;

  const existingTimer = _textSwapTimers.get(el);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  el.classList.remove('is-entering');
  el.classList.add('is-leaving');

  const timer = setTimeout(() => {
    el.textContent = text;
    el.classList.remove('is-leaving');
    el.classList.add('is-entering');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.remove('is-entering');
      });
    });
  }, 180);

  _textSwapTimers.set(el, timer);
}

function _formatClockTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function _formatShortTime(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function _formatDuration(durationMs) {
  const totalSec = Math.max(0, Math.ceil(durationMs / 1000));
  const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

function _formatCompactCountdown(durationMs) {
  const totalSec = Math.max(0, Math.ceil(durationMs / 1000));

  if (totalSec >= 3600) {
    const hours = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function _formatMinuteSecondCountdown(durationMs) {
  const totalSec = Math.max(0, Math.ceil(durationMs / 1000));
  const minutes = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const seconds = String(totalSec % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function _normalizePrayerName(name) {
  const normalized = (name ?? '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  for (const [key, aliases] of Object.entries(PRAYER_CARD_ALIASES)) {
    if (aliases.includes(normalized)) return key;
  }

  return normalized;
}

function _ct(settings, key) {
  const entry = settings?.customText?.[key] ?? CUSTOM_TEXT_DEFAULTS[key];
  if (typeof entry === 'string') return entry; // old format fallback
  return entry?.text ?? CUSTOM_TEXT_DEFAULTS[key].text;
}
function _getCtEntry(settings, key) {
  if (!key) return null;
  const entry = settings?.customText?.[key] ?? CUSTOM_TEXT_DEFAULTS[key];
  if (typeof entry === 'string') return { text: entry, size: CUSTOM_TEXT_DEFAULTS[key].size, color: '', font: '' };
  if (!entry) return null;
  return entry;
}

function _applyTextStyle(el, settings, key) {
  if (!el || !key) return;
  const entry = _getCtEntry(settings, key);
  if (!entry) return;
  if (entry.size) el.style.fontSize = entry.size;
  if (entry.color) el.style.color = entry.color;
  if (entry.font) el.style.fontFamily = entry.font;
}

function _setTextWithStyle(el, text, settings, key) {
  _setText(el, text);
  _applyTextStyle(el, settings, key);
}

function _formatHijriDate(date) {
  try {
    return new Intl.DateTimeFormat('id-ID-u-ca-islamic', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch (_) {
    return 'Tanggal Hijriah belum tersedia';
  }
}

function _getTickerMessage(settings) {
  return String(settings?.tickerMessageText ?? '').trim() || DEFAULT_TICKER_MESSAGE_TEXT;
}

function _getTickerMessages(settings) {
  const raw = _getTickerMessage(settings).trim();
  if (!raw) return [DEFAULT_TICKER_MESSAGE_TEXT];

  // Support format: "message1","message2","message3"
  let messages;
  if (raw.includes('"')) {
    messages = raw
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map(s => s.trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  } else {
    messages = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  }

  return messages.length > 0 ? messages : [DEFAULT_TICKER_MESSAGE_TEXT];
}

function _formatScheduleSource(state) {
  const sourceMap = {
    'api-cache': 'API Cache',
    sample: 'Sample JSON',
    'fallback-hardcoded': 'Fallback Lokal',
    uninitialized: 'Belum dimuat',
  };

  const sourceLabel = sourceMap[state.scheduleSource] ?? state.scheduleSource ?? '-';
  const locationLabel = state.scheduleLocationLabel || state.settings?.prayerLocationName || '-';
  const yearsLabel = state.scheduleYearsLabel || '-';
  const coverageLabel = state.scheduleHasCacheForDate ? 'tersedia' : 'tidak ada';

  return `Sumber jadwal: ${sourceLabel} | Lokasi: ${locationLabel} | Cache tahun: ${yearsLabel} | Hari ini: ${coverageLabel}`;
}

export function setClock(now) {
  if (!now) return;
  _setText(_els.clock, _formatClockTime(now));
}

export function setDates(now) {
  if (!now) return;

  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (dateKey === _lastDateKey) return;
  _lastDateKey = dateKey;

  const gregorian = now.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  _setText(_els.dateGregorian, gregorian);
  _setText(_els.dateHijri, _formatHijriDate(now));
}

export function setNextPrayer(
  now,
  prayer,
  currentPrayer,
  fsmState,
  iqomahRemainingMs,
  visible,
  fridayPhaseRemainingMs = 0,
  isFridayPrayer = false,
  settings = null
) {
  _setHidden(_els.nextPrayerSummary, !visible);
  _setHidden(_els.iqomahCountdown, true);
  if (!visible || !now) return;

  const ct = (key) => _ct(settings, key);

  if (fsmState === 'FRIDAY_QABLIYAH') {
    _setText(_els.nextPrayerCountdown, _formatCompactCountdown(fridayPhaseRemainingMs));
    _setText(_els.nextPrayerTime, ct('focusAzanKhutbahName'));
    return;
  }

  if (fsmState === 'FRIDAY_KHUTBAH') {
    _setText(_els.nextPrayerCountdown, _formatMinuteSecondCountdown(fridayPhaseRemainingMs));
    _setText(_els.nextPrayerTime, '');
    return;
  }

  if (fsmState === 'FRIDAY_IQOMAH' && currentPrayer) {
    _setText(_els.nextPrayerCountdown, _formatCompactCountdown(iqomahRemainingMs));
    _setText(_els.nextPrayerTime, `${ct('focusIqomahJumat')}`);
    return;
  }

  if (fsmState === 'AZAN' && currentPrayer) {
    _setText(_els.nextPrayerCountdown, '00:00');
    const prayerLabel = isFridayPrayer ? ct('prayerLabelJumat') : currentPrayer.name;
    _setText(_els.nextPrayerTime, `${_formatShortTime(currentPrayer.time)} ${prayerLabel}`);
    return;
  }

  if (fsmState === 'IQOMAH' && currentPrayer) {
    _setText(_els.nextPrayerCountdown, _formatCompactCountdown(iqomahRemainingMs));
    _setText(_els.nextPrayerTime, `${ct('focusIqomah')} ${currentPrayer.name}`);
    return;
  }

  if (!prayer) {
    _setText(_els.nextPrayerCountdown, '--:--');
    _setText(_els.nextPrayerTime, '--:-- -');
    return;
  }

  // Timerless prayers (Imsak, Syuruq): only status in prayer strip, no hero badge countdown
  if (prayer.isTimerless) {
    _setHidden(_els.nextPrayerSummary, true);
    return;
  }

  const remainingMs = prayer.time.getTime() - now.getTime();
  const prayerLabel = isFridayPrayer && _normalizePrayerName(prayer.name) === 'dzuhur'
    ? ct('prayerLabelJumat')
    : prayer.name;
  _setText(_els.nextPrayerCountdown, _formatCompactCountdown(remainingMs));
  _setText(_els.nextPrayerTime, `${_formatShortTime(prayer.time)} ${prayerLabel}`);
}

export function setIqomahCountdown(remainingMs, visible, settings = null) {
  _setHidden(_els.iqomahCountdown, !visible);
  if (!visible) return;

  const safeMs = Math.max(0, remainingMs);
  const prefix = _ct(settings, 'heroIqomahPrefix');
  _setText(_els.iqomahCountdown, `${prefix} ${_formatDuration(safeMs)}`);
}

export function setPrayerStrip(schedule, currentPrayer, nextPrayer, now, settings = null) {
  const scheduleMap = new Map();

  for (const entry of schedule ?? []) {
    const key = _normalizePrayerName(entry.name);
    if (!scheduleMap.has(key)) {
      scheduleMap.set(key, _formatShortTime(entry.time));
    }
  }

  const currentKey = _normalizePrayerName(currentPrayer?.name);
  const nextKey = _normalizePrayerName(nextPrayer?.name);

  const ct = (key) => _ct(settings, key);
  const prayerLabels = {
    imsak: ct('prayerLabelImsak'),
    subuh: ct('prayerLabelSubuh'),
    syuruq: ct('prayerLabelSyuruq'),
    dzuhur: ct('prayerLabelDzuhur'),
    ashar: ct('prayerLabelAshar'),
    maghrib: ct('prayerLabelMaghrib'),
    isya: ct('prayerLabelIsya'),
  };

  for (const card of _els.prayerCards) {
    const key = card.dataset.prayerKey;
    const labelEl = card.querySelector('.prayer-label');
    const timeEl = card.querySelector('.prayer-time');
    const value = scheduleMap.get(key) ?? '--:--';

    if (labelEl) {
      if (key === 'dzuhur') {
        const ctKey = now?.getDay() === 5 ? 'prayerLabelJumat' : 'prayerLabelDzuhur';
        _setTextWithStyle(labelEl, ct(ctKey), settings, ctKey);
      } else {
        const ctKey = `prayerLabel${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        _setTextWithStyle(labelEl, prayerLabels[key] ?? key, settings, ctKey);
      }
    }

    if (timeEl) _setText(timeEl, value);

    card.classList.toggle('is-current', currentKey === key);
    card.classList.toggle('is-next', currentKey !== key && nextKey === key);
  }
}

export function setFocusOverlay(state, settings = null) {
  const show =
    state.fsmState === 'PRE_AZAN' ||
    state.fsmState === 'AZAN' ||
    state.fsmState === 'FRIDAY_QABLIYAH' ||
    state.fsmState === 'FRIDAY_KHUTBAH_AZAN' ||
    state.fsmState === 'FRIDAY_IQOMAH' ||
    state.fsmState === 'IQOMAH';

  _setHidden(_els.focusOverlay, !show);
  if (!show || !state.now) return;

  const ct = (key) => _ct(settings, key);

  if (state.fsmState === 'PRE_AZAN') {
    const remainingMs = state.nextPrayer
      ? Math.max(0, state.nextPrayer.time.getTime() - state.now.getTime())
      : 0;
    const prayerName = state.nextPrayer?.name ?? 'Waktu Sholat';

    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, false);
    _setHidden(_els.focusOverlaySecondary, true);
    _setTextWithStyle(_els.focusOverlayLabel, state.isFridayPrayer ? ct('focusMenujuAzanJumat') : ct('focusMenujuAdzan'), settings, state.isFridayPrayer ? 'focusMenujuAzanJumat' : 'focusMenujuAdzan');
    _setTextWithStyle(_els.focusOverlayPrayer, state.isFridayPrayer ? ct('prayerLabelJumat') : prayerName, settings, state.isFridayPrayer ? 'prayerLabelJumat' : null);
    _setText(_els.focusOverlayPrimary, _formatCompactCountdown(remainingMs));
    return;
  }

  if (state.fsmState === 'AZAN') {
    const prayerName = state.isFridayPrayer ? ct('focusWaktuAzanJumat') : (state.currentPrayer?.name ?? 'Waktu Sholat');
    const prayerTime = state.currentPrayer?.time ? _formatShortTime(state.currentPrayer.time) : '--:--';

    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, true);
    _setHidden(_els.focusOverlaySecondary, false);
    _setTextWithStyle(_els.focusOverlayLabel, state.isFridayPrayer ? ct('focusWaktuAzanJumat') : ct('focusWaktuAdzan'), settings, state.isFridayPrayer ? 'focusWaktuAzanJumat' : 'focusWaktuAdzan');
    _setText(_els.focusOverlayPrimary, prayerName);
    _setTextWithStyle(_els.focusOverlaySecondaryLabel, ct('focusPukul'), settings, 'focusPukul');
    _setText(_els.focusOverlaySecondaryTime, prayerTime);
    return;
  }

  if (state.fsmState === 'FRIDAY_QABLIYAH') {
    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, false);
    _setHidden(_els.focusOverlaySecondary, true);
    _setTextWithStyle(_els.focusOverlayLabel, ct('focusJedaQabliyah'), settings, 'focusJedaQabliyah');
    _setTextWithStyle(_els.focusOverlayPrayer, ct('focusAzanKhutbah'), settings, 'focusAzanKhutbah');
    _setText(_els.focusOverlayPrimary, _formatCompactCountdown(state.fridayPhaseRemainingMs));
    return;
  }

  if (state.fsmState === 'FRIDAY_KHUTBAH_AZAN') {
    const prayerTime = state.fridayKhutbahAzanTime ? _formatShortTime(state.fridayKhutbahAzanTime) : '--:--';

    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, true);
    _setHidden(_els.focusOverlaySecondary, false);
    _setTextWithStyle(_els.focusOverlayLabel, ct('focusWaktuAzanKhutbah'), settings, 'focusWaktuAzanKhutbah');
    _setTextWithStyle(_els.focusOverlayPrimary, ct('focusAzanKhutbah'), settings, 'focusAzanKhutbah');
    _setTextWithStyle(_els.focusOverlaySecondaryLabel, ct('focusPukul'), settings, 'focusPukul');
    _setText(_els.focusOverlaySecondaryTime, prayerTime);
    return;
  }

  if (state.fsmState === 'FRIDAY_IQOMAH') {
    const prayerName = state.currentPrayer?.name ?? ct('focusIqomahJumat');
    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, false);
    _setHidden(_els.focusOverlaySecondary, true);
    _setTextWithStyle(_els.focusOverlayLabel, ct('focusIqomahJumat'), settings, 'focusIqomahJumat');
    _setTextWithStyle(_els.focusOverlayPrayer, ct('prayerLabelJumat'), settings, 'prayerLabelJumat');
    _setText(_els.focusOverlayPrimary, _formatCompactCountdown(state.iqomahRemainingMs));
    return;
  }

  const prayerName = state.currentPrayer?.name ?? ct('focusIqomah');
  _setHidden(_els.focusOverlayLabel, false);
  _setHidden(_els.focusOverlayPrayer, false);
  _setHidden(_els.focusOverlaySecondary, true);
  _setTextWithStyle(_els.focusOverlayLabel, ct('focusIqomah'), settings, 'focusIqomah');
  _setText(_els.focusOverlayPrayer, prayerName);
  _setText(_els.focusOverlayPrimary, _formatCompactCountdown(state.iqomahRemainingMs));
}

export function setTickerMessage(settings) {
  const messages = _getTickerMessages(settings);
  const signature = messages.join('\n');

  if (signature === _tickerSignature) return;

  _tickerMessages = messages;
  _tickerSignature = signature;
  _tickerIndex = 0;
  _playTickerMessage(true);
}

export function setOperatorStatus(state) {
  _setText(_els.opStatusText, _formatScheduleSource(state));
}

export function setFsmBadge(state) {
  _setText(_els.fsmBadge, state);
  _setDataAttr(_els.fsmBadge, 'state', state);
  _setDataAttr(document.body, 'fsmState', state);
}

export function setSimBanner(state, settings = null) {
  const banner = _els.simBanner;
  if (!banner) return;

  if (!isSim()) {
    banner.classList.remove('is-active');
    return;
  }

  banner.classList.add('is-active');

  if (state.now) {
    const h = String(state.now.getHours()).padStart(2, '0');
    const m = String(state.now.getMinutes()).padStart(2, '0');
    const s = String(state.now.getSeconds()).padStart(2, '0');
    _setText(_els.simBannerTime, `${h}:${m}:${s}`);
  }

  _setText(_els.simBannerSpeed, `${getSpeed()}x`);
  _setText(_els.simBannerFase, state.fsmState);

  const label = _ct(settings, 'simBannerLabel');
  const labelEl = _els.simBanner.querySelector('#sim-banner-label');
  if (labelEl) {
    _setTextWithStyle(labelEl, label, settings, 'simBannerLabel');
  }
}

export function setIdentity(settings) {
  if (!settings) return;

  const nameEl = _els.masjidName;
  const addressEl = _els.masjidAddress;
  const logoEl = _els.masjidLogo;

  if (nameEl && settings.masjidName) {
    nameEl.textContent = settings.masjidName;
  }

  if (addressEl && settings.masjidAddress) {
    addressEl.textContent = settings.masjidAddress;
  }

  if (logoEl && settings.logoPath) {
    logoEl.src = settings.logoPath;
  }
}

export function applyDisplaySettings(settings) {
  if (!settings) return;
  applyTextScale(settings.textScale ?? 1.0);
  applyTheme(settings.themePreset, settings.themeOverride);
  if (typeof settings.stripBackgroundOpacity === 'number') {
    _applyStripOpacity(settings.stripBackgroundOpacity);
  }
}

function applyTextScale(scale) {
  const root = document.documentElement;
  root.style.setProperty('--text-scale', String(scale));

  // Auto-fit: shrink masjid name if it overflows
  const nameEl = _els.masjidName;
  if (nameEl) {
    nameEl.style.fontSize = '';
    nameEl.style.whiteSpace = 'nowrap';

    const container = nameEl.closest('#masjid-meta');
    if (container) {
      const containerWidth = container.clientWidth;
      let fontSize = parseFloat(getComputedStyle(nameEl).fontSize);
      while (nameEl.scrollWidth > containerWidth && fontSize > 12) {
        fontSize -= 1;
        nameEl.style.fontSize = `${fontSize}px`;
      }
    }
  }
}

function applyTheme(preset, override) {
  const root = document.documentElement;
  const presetVars = THEME_PRESETS[preset] ?? THEME_PRESETS.navy;

  // Apply preset
  for (const [key, val] of Object.entries(presetVars)) {
    root.style.setProperty(key, val);
  }

  // Apply allowed overrides on top
  if (override && typeof override === 'object') {
    for (const [key, val] of Object.entries(override)) {
      root.style.setProperty(key, val);
    }
  }
}

export function setError(message) {
  const show = Boolean(message);
  _setHidden(_els.errorOverlay, !show);
  if (show) _setText(_els.errorMessage, message);
}

export function renderAll(state) {
  const isError = state.fsmState === 'ERROR';

  setError(isError ? 'Terjadi kesalahan pada sistem. Silakan hubungi operator.' : null);
  setFsmBadge(state.fsmState);
  setSimBanner(state, state.settings);

  setIdentity(state.settings);

  if (isError) return;

  setFocusOverlay(state, state.settings);
  setClock(state.now);
  setDates(state.now);
  setNextPrayer(
    state.now,
    state.nextPrayer,
    state.currentPrayer,
    state.fsmState,
    state.iqomahRemainingMs,
    true,
    state.fridayPhaseRemainingMs,
    state.isFridayPrayer,
    state.settings
  );
  setIqomahCountdown(state.iqomahRemainingMs, false, state.settings);
  setPrayerStrip(state.dailySchedule, state.currentPrayer, state.nextPrayer, state.now, state.settings);
  setTickerMessage(state.settings);
  setOperatorStatus(state);
}

function _playTickerMessage(resetIndex = false) {
  if (!_els.tickerViewport || !_els.tickerTrack || !_els.tickerText) return;

  if (resetIndex) {
    _tickerIndex = 0;
  }

  _clearTickerPlayback();

  const message = _tickerMessages[_tickerIndex] ?? DEFAULT_TICKER_MESSAGE_TEXT;
  _setText(_els.tickerText, message);
  _els.tickerTrack.style.transition = 'none';
  _els.tickerTrack.style.transform = 'translate3d(0, 0, 0)';

  _tickerRafA = requestAnimationFrame(() => {
    const viewportWidth = Math.max(1, Math.ceil(_els.tickerViewport.getBoundingClientRect().width));
    const messageWidth = Math.max(1, Math.ceil(_els.tickerText.getBoundingClientRect().width));
    const edgePadding = Math.max(28, Math.round(viewportWidth * 0.04));
    const startX = viewportWidth + edgePadding;
    const endX = -messageWidth - edgePadding;
    const distance = startX - endX;
    const durationMs = Math.max(
      TICKER_MIN_DURATION_MS,
      Math.round((distance / TICKER_TRAVEL_PX_PER_SECOND) * 1000)
    );

    _els.tickerTrack.style.transition = 'none';
    _els.tickerTrack.style.transform = `translate3d(${startX}px, 0, 0)`;

    _tickerRafB = requestAnimationFrame(() => {
      _els.tickerTrack.style.transition = `transform ${durationMs}ms linear`;
      _els.tickerTrack.style.transform = `translate3d(${endX}px, 0, 0)`;

      _tickerTimer = window.setTimeout(() => {
        _tickerIndex = (_tickerIndex + 1) % _tickerMessages.length;
        _playTickerMessage(false);
      }, durationMs + TICKER_GAP_MS);
    });
  });
}

function _handleTickerResize() {
  if (_tickerResizeTimer !== null) {
    clearTimeout(_tickerResizeTimer);
  }

  _tickerResizeTimer = window.setTimeout(() => {
    _tickerResizeTimer = null;
    if (_tickerSignature) {
      _playTickerMessage(false);
    }
  }, 140);
}

function _clearTickerPlayback() {
  if (_tickerTimer !== null) {
    clearTimeout(_tickerTimer);
    _tickerTimer = null;
  }

  if (_tickerRafA) {
    cancelAnimationFrame(_tickerRafA);
    _tickerRafA = 0;
  }

  if (_tickerRafB) {
    cancelAnimationFrame(_tickerRafB);
    _tickerRafB = 0;
  }
}

function _applyStripOpacity(opacity) {
  const o = Math.min(1, Math.max(0, opacity));
  const stripBackground = `rgba(4, 16, 36, ${o})`;
  ['top-header', 'ticker-bar', 'prayer-strip'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.background = stripBackground;
  });
  const badge = document.getElementById('hero-badge');
  if (badge) {
    const badgeOpacity = Math.min(1, o + 0.12);
    badge.style.background = `rgba(4, 16, 36, ${badgeOpacity})`;
  }
}

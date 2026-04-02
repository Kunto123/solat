/**
 * ui/render.js - DOM update functions
 */

import {
  DEFAULT_SIDE_MESSAGE_TEXT,
  DEFAULT_TICKER_MESSAGE_TEXT,
} from '../services/settings.js';

const PRAYER_CARD_ALIASES = {
  imsak: ['imsak'],
  subuh: ['subuh', 'shubuh', 'fajr'],
  dhuha: ['dhuha', 'duha', 'syuruq', 'syuruk', 'sunrise'],
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
    sideMessageText: document.getElementById('side-message-text'),
    tickerViewport: document.getElementById('ticker-viewport'),
    tickerTrack: document.getElementById('ticker-track'),
    tickerText: document.getElementById('ticker-text'),
    opStatusText: document.getElementById('op-status-text'),
    fsmBadge: document.getElementById('fsm-badge'),
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

function _getSideMessage(state) {
  const settingsMessage = Array.isArray(state.settings?.sideMessages)
    ? state.settings.sideMessages.find(message => String(message ?? '').trim() !== '')
    : null;

  return state.activeSideMessage || settingsMessage || DEFAULT_SIDE_MESSAGE_TEXT;
}

function _getTickerMessage(settings) {
  return String(settings?.tickerMessageText ?? '').trim() || DEFAULT_TICKER_MESSAGE_TEXT;
}

function _getTickerMessages(settings) {
  const lines = _getTickerMessage(settings)
    .split(/\r?\n/)
    .map(message => message.trim())
    .filter(Boolean)
    .map(message => message.slice(0, 280));

  return lines.length > 0 ? lines : [DEFAULT_TICKER_MESSAGE_TEXT];
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

export function setNextPrayer(now, prayer, currentPrayer, fsmState, iqomahRemainingMs, visible) {
  _setHidden(_els.nextPrayerSummary, !visible);
  _setHidden(_els.iqomahCountdown, true);
  if (!visible || !now) return;

  if (fsmState === 'AZAN' && currentPrayer) {
    _setText(_els.nextPrayerCountdown, '00:00');
    _setText(_els.nextPrayerTime, `${_formatShortTime(currentPrayer.time)} ${currentPrayer.name}`);
    return;
  }

  if (fsmState === 'IQOMAH' && currentPrayer) {
    _setText(_els.nextPrayerCountdown, _formatCompactCountdown(iqomahRemainingMs));
    _setText(_els.nextPrayerTime, `Iqomah ${currentPrayer.name}`);
    return;
  }

  if (!prayer) {
    _setText(_els.nextPrayerCountdown, '--:--');
    _setText(_els.nextPrayerTime, '--:-- -');
    return;
  }

  const remainingMs = prayer.time.getTime() - now.getTime();
  _setText(_els.nextPrayerCountdown, _formatCompactCountdown(remainingMs));
  _setText(_els.nextPrayerTime, `${_formatShortTime(prayer.time)} ${prayer.name}`);
}

export function setIqomahCountdown(remainingMs, visible) {
  _setHidden(_els.iqomahCountdown, !visible);
  if (!visible) return;

  const safeMs = Math.max(0, remainingMs);
  _setText(_els.iqomahCountdown, `Iqomah ${_formatDuration(safeMs)}`);
}

export function setPrayerStrip(schedule, currentPrayer, nextPrayer) {
  const scheduleMap = new Map();

  for (const entry of schedule ?? []) {
    const key = _normalizePrayerName(entry.name);
    if (!scheduleMap.has(key)) {
      scheduleMap.set(key, _formatShortTime(entry.time));
    }
  }

  const currentKey = _normalizePrayerName(currentPrayer?.name);
  const nextKey = _normalizePrayerName(nextPrayer?.name);

  for (const card of _els.prayerCards) {
    const key = card.dataset.prayerKey;
    const timeEl = card.querySelector('.prayer-time');
    const value = scheduleMap.get(key) ?? '--:--';

    if (timeEl) _setText(timeEl, value);

    card.classList.toggle('is-current', currentKey === key);
    card.classList.toggle('is-next', currentKey !== key && nextKey === key);
  }
}

export function setFocusOverlay(state) {
  const show =
    state.fsmState === 'PRE_AZAN' ||
    state.fsmState === 'AZAN' ||
    state.fsmState === 'IQOMAH';

  _setHidden(_els.focusOverlay, !show);
  if (!show || !state.now) return;

  if (state.fsmState === 'PRE_AZAN') {
    const remainingMs = state.nextPrayer
      ? Math.max(0, state.nextPrayer.time.getTime() - state.now.getTime())
      : 0;
    const prayerName = state.nextPrayer?.name ?? 'Waktu Sholat';

    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, false);
    _setHidden(_els.focusOverlaySecondary, true);
    _setText(_els.focusOverlayLabel, 'Menuju Adzan');
    _setText(_els.focusOverlayPrayer, prayerName);
    _setText(_els.focusOverlayPrimary, _formatCompactCountdown(remainingMs));
    return;
  }

  if (state.fsmState === 'AZAN') {
    const prayerName = state.currentPrayer?.name ?? 'Waktu Sholat';
    const prayerTime = state.currentPrayer?.time ? _formatShortTime(state.currentPrayer.time) : '--:--';

    _setHidden(_els.focusOverlayLabel, false);
    _setHidden(_els.focusOverlayPrayer, true);
    _setHidden(_els.focusOverlaySecondary, false);
    _setText(_els.focusOverlayLabel, 'Waktu Adzan');
    _setText(_els.focusOverlayPrimary, prayerName);
    _setText(_els.focusOverlaySecondaryLabel, 'Pukul');
    _setText(_els.focusOverlaySecondaryTime, prayerTime);
    return;
  }

  const prayerName = state.currentPrayer?.name ?? 'Iqomah';
  _setHidden(_els.focusOverlayLabel, false);
  _setHidden(_els.focusOverlayPrayer, false);
  _setHidden(_els.focusOverlaySecondary, true);
  _setText(_els.focusOverlayLabel, 'Iqomah');
  _setText(_els.focusOverlayPrayer, prayerName);
  _setText(_els.focusOverlayPrimary, _formatCompactCountdown(state.iqomahRemainingMs));
}

export function setSideMessage(state) {
  _swapTextWithFade(_els.sideMessageText, _getSideMessage(state));
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

export function setError(message) {
  const show = Boolean(message);
  _setHidden(_els.errorOverlay, !show);
  if (show) _setText(_els.errorMessage, message);
}

export function renderAll(state) {
  const isError = state.fsmState === 'ERROR';

  setError(isError ? 'Terjadi kesalahan pada sistem. Silakan hubungi operator.' : null);
  setFsmBadge(state.fsmState);

  if (isError) return;

  setFocusOverlay(state);
  setClock(state.now);
  setDates(state.now);
  setNextPrayer(
    state.now,
    state.nextPrayer,
    state.currentPrayer,
    state.fsmState,
    state.iqomahRemainingMs,
    true
  );
  setIqomahCountdown(state.iqomahRemainingMs, false);
  setPrayerStrip(state.dailySchedule, state.currentPrayer, state.nextPrayer);
  setSideMessage(state);
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

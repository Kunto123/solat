/**
 * services/prayerTimeline.js
 *
 * Domain logic jadwal sholat dan window fase tampilan.
 */

import { DEFAULT_PRAYER_PHASE_DURATIONS } from './settings.js';

/** @type {{ getSchedule: (date: Date) => PrayerEntry[] } | null} */
let _provider = null;
let _phaseDurations = _clonePhaseDurations(DEFAULT_PRAYER_PHASE_DURATIONS);

const IQOMAH_DURATION_MS = 5 * 60 * 1000;
const POST_IQOMAH_EXTRA_MS = 10 * 60 * 1000;

/**
 * @typedef {{ name: string, time: Date }} PrayerEntry
 */

/**
 * @param {{ getSchedule: (date: Date) => PrayerEntry[] }} provider
 * @param {number | { iqomahDelayMinutes?: number, preAzanWarningMinutes?: number, azanDisplayMinutes?: number }} [options]
 */
export function init(provider, options = 10) {
  _provider = provider;

  if (typeof options === 'number') {
    _phaseDurations = _clonePhaseDurations(DEFAULT_PRAYER_PHASE_DURATIONS);
    return;
  }

  _phaseDurations = _normalizePhaseDurations(options?.prayerPhaseDurations);
}

/**
 * @param {Date} date
 * @returns {PrayerEntry[]}
 */
export function getDailySchedule(date) {
  if (!_provider) throw new Error('Prayer provider belum diinisialisasi');
  return _provider.getSchedule(date);
}

/**
 * @param {Date} now
 * @returns {PrayerEntry | null}
 */
export function getCurrentPrayer(now) {
  const schedule = getDailySchedule(now);
  let current = null;

  for (const prayer of schedule) {
    if (prayer.time <= now) current = prayer;
    else break;
  }

  return current;
}

/**
 * @param {Date} now
 * @returns {PrayerEntry | null}
 */
export function getNextPrayer(now) {
  const schedule = getDailySchedule(now);
  const next = schedule.find(prayer => prayer.time > now);
  if (next) return next;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowSchedule = getDailySchedule(tomorrow);
  return tomorrowSchedule[0] ?? null;
}

/**
 * @param {PrayerEntry} prayer
 * @returns {Date}
 */
export function getIqomahTime(prayer) {
  return new Date(prayer.time.getTime() + _getPrayerConfig(prayer).iqomahDelayMinutes * 60 * 1000);
}

/**
 * @param {PrayerEntry} prayer
 * @returns {Date}
 */
export function getAzanDisplayEndTime(prayer) {
  return new Date(prayer.time.getTime() + _getPrayerConfig(prayer).azanDisplayMinutes * 60 * 1000);
}

/**
 * @param {Date} now
 * @param {PrayerEntry} prayer
 * @returns {number}
 */
export function getIqomahRemainingMs(now, prayer) {
  const iqomahTime = getIqomahTime(prayer);
  return Math.max(0, iqomahTime.getTime() - now.getTime());
}

/**
 * @param {Date} now
 * @param {PrayerEntry} prayer
 * @returns {number}
 */
export function getAzanRemainingMs(now, prayer) {
  const azanEndTime = getAzanDisplayEndTime(prayer);
  return Math.max(0, azanEndTime.getTime() - now.getTime());
}

/**
 * @param {Date} now
 * @param {PrayerEntry | null} prayer
 * @returns {number}
 */
export function getPreAzanRemainingMs(now, prayer) {
  if (!prayer) return 0;
  return Math.max(0, prayer.time.getTime() - now.getTime());
}

/**
 * @param {Date} now
 * @param {PrayerEntry | null} prayer
 * @returns {boolean}
 */
export function isPreAzanWindow(now, prayer) {
  if (!prayer || prayer.isTimerless) return false;
  const remainingMs = prayer.time.getTime() - now.getTime();
  return remainingMs > 0 && remainingMs <= (_getPrayerConfig(prayer).preAzanMinutes * 60 * 1000);
}

/**
 * @param {Date} now
 * @param {PrayerEntry | null} prayer
 * @returns {boolean}
 */
export function isAzanWindow(now, prayer) {
  if (!prayer || prayer.isTimerless) return false;
  const azanEndTime = getAzanDisplayEndTime(prayer);
  return now >= prayer.time && now < azanEndTime;
}

/**
 * @param {Date} now
 * @param {PrayerEntry | null} prayer
 * @returns {boolean}
 */
export function isIqomahWindow(now, prayer) {
  if (!prayer || prayer.isTimerless) return false;
  const azanEndTime = getAzanDisplayEndTime(prayer);
  const iqomahTime = getIqomahTime(prayer);
  return now >= azanEndTime && now < iqomahTime;
}

/**
 * @param {Date} now
 * @param {PrayerEntry | null} prayer
 * @returns {boolean}
 */
export function isPostIqomahWindow(now, prayer) {
  if (!prayer || prayer.isTimerless) return false;
  const iqomahTime = getIqomahTime(prayer);
  const postEnd = new Date(iqomahTime.getTime() + IQOMAH_DURATION_MS + POST_IQOMAH_EXTRA_MS);
  return now >= iqomahTime && now < postEnd;
}

function _clonePhaseDurations(source) {
  return _normalizePhaseDurations(source);
}

function _normalizePhaseDurations(source = {}) {
  const normalized = {};

  for (const [prayerKey, fallback] of Object.entries(DEFAULT_PRAYER_PHASE_DURATIONS)) {
    const current = source?.[prayerKey] ?? {};
    normalized[prayerKey] = {
      preAzanMinutes: _sanitizeMinutes(current.preAzanMinutes, fallback.preAzanMinutes),
      azanDisplayMinutes: _sanitizeMinutes(current.azanDisplayMinutes, fallback.azanDisplayMinutes),
      iqomahDelayMinutes: _sanitizeMinutes(current.iqomahDelayMinutes, fallback.iqomahDelayMinutes),
    };
  }

  return normalized;
}

function _sanitizeMinutes(value, fallback) {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) return Number(fallback);
  return Math.min(60, Math.max(1, Math.round(safeValue)));
}

function _getPrayerConfig(prayer) {
  const prayerKey = _normalizePrayerKey(prayer?.name);
  return _phaseDurations[prayerKey] ?? DEFAULT_PRAYER_PHASE_DURATIONS[prayerKey] ?? DEFAULT_PRAYER_PHASE_DURATIONS.dzuhur;
}

function _normalizePrayerKey(name) {
  const normalized = String(name ?? '').trim().toLowerCase();

  if (normalized === 'subuh' || normalized === 'shubuh' || normalized === 'fajr') return 'subuh';
  if (normalized === 'dzuhur' || normalized === 'zuhur' || normalized === 'dhuhur') return 'dzuhur';
  if (normalized === 'ashar' || normalized === 'asar') return 'ashar';
  if (normalized === 'maghrib') return 'maghrib';
  if (normalized === 'isya' || normalized === 'isha') return 'isya';

  return normalized;
}

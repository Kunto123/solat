/**
 * providers/prayerScheduleHybrid.js
 *
 * Provider hybrid:
 * 1. cache API lokal
 * 2. sample JSON
 * 3. fallback hardcoded
 */

import * as prayerCache from '../services/prayerCache.js';

const SAMPLE_SOURCE_URL = './js/data/schedule-sample.json';

const RUNTIME_PRAYERS = [
  { key: 'subuh', name: 'Subuh' },
  { key: 'dzuhur', name: 'Dzuhur' },
  { key: 'ashar', name: 'Ashar' },
  { key: 'maghrib', name: 'Maghrib' },
  { key: 'isya', name: 'Isya' },
];

const DISPLAY_PRAYERS = [
  { key: 'imsak', name: 'Imsak' },
  { key: 'subuh', name: 'Subuh' },
  { key: 'terbit', name: 'Syuruq' },
  { key: 'dzuhur', name: 'Dzuhur' },
  { key: 'ashar', name: 'Ashar' },
  { key: 'maghrib', name: 'Maghrib' },
  { key: 'isya', name: 'Isya' },
];

/** @type {Record<string, Array<{name: string, time: string}>> | null} */
let _sampleData = null;
let _sampleLoaded = false;
let _cacheDays = {};
let _cacheYears = [];
let _cacheMeta = null;
let _runtimeSource = 'uninitialized';

export async function load(options = {}) {
  const locationId = options.locationId ?? null;
  _runtimeSource = 'uninitialized';

  if (!locationId) {
    _cacheDays = {};
    _cacheYears = [];
    _cacheMeta = null;
  } else {
    const cache = await prayerCache.readLocationCache(locationId);
    _cacheDays = cache.days ?? {};
    _cacheYears = Array.isArray(cache.years) ? cache.years : [];
    _cacheMeta = cache.location ?? null;
  }

  if (!_sampleLoaded) {
    try {
      await _loadSampleData();
      _sampleLoaded = true;
    } catch (_) {
      _sampleLoaded = false;
      _sampleData = null;
    }
  }
}

export function getSchedule(date) {
  const cachedEntries = _entriesFromCache(date, RUNTIME_PRAYERS);
  if (cachedEntries.length > 0) {
    _runtimeSource = 'api-cache';
    return cachedEntries;
  }

  const sampleEntries = _entriesFromSample(date);
  if (sampleEntries.length > 0) {
    _runtimeSource = 'sample';
    return sampleEntries;
  }

  _runtimeSource = 'fallback-hardcoded';
  return _fallbackEntries(date, RUNTIME_PRAYERS, {
    subuh: '04:32',
    dzuhur: '11:56',
    ashar: '15:15',
    maghrib: '17:57',
    isya: '19:08',
  });
}

export function getDisplaySchedule(date) {
  const cachedEntries = _entriesFromCache(date, DISPLAY_PRAYERS);
  if (cachedEntries.length > 0) {
    _runtimeSource = 'api-cache';
    return cachedEntries;
  }

  const sampleEntries = _entriesFromSample(date);
  if (sampleEntries.length > 0) {
    _runtimeSource = 'sample';
    return sampleEntries;
  }

  _runtimeSource = 'fallback-hardcoded';
  return _fallbackEntries(date, DISPLAY_PRAYERS, {
    imsak: '04:20',
    subuh: '04:32',
    terbit: '05:58',
    dzuhur: '11:56',
    ashar: '15:15',
    maghrib: '17:57',
    isya: '19:08',
  });
}

export function getCacheMeta() {
  return _cacheMeta ? { ..._cacheMeta } : null;
}

export function getRuntimeStatus(date = new Date()) {
  return {
    source: _runtimeSource,
    cacheYears: [..._cacheYears],
    hasCacheForDate: Boolean(_cacheDays[_formatIsoKey(date)]?.times),
    hasSampleForDate: Boolean(
      Array.isArray(_sampleData?.[_formatSampleKey(date)]) &&
      _sampleData[_formatSampleKey(date)].length > 0
    ),
    location: getCacheMeta(),
  };
}

async function _loadSampleData() {
  if (_sampleData) return;

  const response = await fetch(SAMPLE_SOURCE_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Gagal memuat schedule-sample.json: ${response.status}`);
  }

  _sampleData = await response.json();
}

function _entriesFromCache(date, fields) {
  const day = _cacheDays[_formatIsoKey(date)];
  if (!day?.times) return [];

  return fields
    .filter(field => typeof day.times[field.key] === 'string' && day.times[field.key].trim() !== '')
    .map(field => ({
      name: field.name,
      time: _parseTime(date, day.times[field.key]),
    }))
    .sort((a, b) => a.time - b.time);
}

function _entriesFromSample(date) {
  const entries = Array.isArray(_sampleData?.[_formatSampleKey(date)])
    ? _sampleData[_formatSampleKey(date)]
    : [];

  return entries
    .filter(entry => entry?.name && entry?.time)
    .map(entry => ({
      name: entry.name,
      time: _parseTime(date, entry.time),
    }))
    .sort((a, b) => a.time - b.time);
}

function _fallbackEntries(date, fields, times) {
  return fields
    .filter(field => typeof times[field.key] === 'string')
    .map(field => ({
      name: field.name,
      time: _parseTime(date, times[field.key]),
    }))
    .sort((a, b) => a.time - b.time);
}

function _formatIsoKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function _formatSampleKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${month}-${day}`;
}

function _parseTime(date, timeStr) {
  const [hour, minute] = String(timeStr).split(':').map(Number);
  const parsed = new Date(date);
  parsed.setHours(hour, minute, 0, 0);
  return parsed;
}

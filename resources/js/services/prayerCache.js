/**
 * services/prayerCache.js - JSON cache for prayer schedules.
 */

import { isNeutralinoRuntime, storageGet, storageSet } from './platform.js';

const CACHE_ROOT_RELATIVE_PATH = './resources/js/data/jadwal-sholat';
const WEB_CACHE_PREFIX = 'masjid_prayer_cache:';
const WEB_CACHE_INDEX_PREFIX = 'masjid_prayer_cache_index:';
const SCHEMA_VERSION = 1;
const SOURCE_NAME = 'myquran-v3';
const SOURCE_BASE_URL = 'https://api.myquran.com/v3/';

let _cacheRootPath = null;

export async function getCacheRootPath() {
  if (!isNeutralinoRuntime) {
    return `${WEB_CACHE_PREFIX}root`;
  }

  if (_cacheRootPath) return _cacheRootPath;
  _cacheRootPath = await Neutralino.filesystem.getAbsolutePath(CACHE_ROOT_RELATIVE_PATH);
  return _cacheRootPath;
}

export async function ensureCacheRoot() {
  if (!isNeutralinoRuntime) {
    return getCacheRootPath();
  }

  const root = await getCacheRootPath();

  try {
    const stats = await Neutralino.filesystem.getStats(root);
    if (!stats.isDirectory) throw new Error(`Path cache bukan folder: ${root}`);
  } catch (_) {
    await Neutralino.filesystem.createDirectory(root);
  }

  return root;
}

export async function readLocationCache(locationId) {
  if (!locationId) {
    return { location: null, updatedAt: null, days: {}, years: [] };
  }

  const years = await listLocationYears(locationId);
  const days = {};
  let location = null;
  let updatedAt = null;

  for (const year of years) {
    const cache = await readYear(locationId, year);
    if (!cache) continue;

    Object.assign(days, cache.days ?? {});
    location = cache.location ?? location;
    if (!updatedAt || (cache.updatedAt && cache.updatedAt > updatedAt)) {
      updatedAt = cache.updatedAt ?? updatedAt;
    }
  }

  return { location, updatedAt, days, years };
}

export async function mergeMonthlySchedule(monthlyData) {
  _assertMonthlyData(monthlyData);

  const dayKeys = Object.keys(monthlyData.jadwal).sort();
  if (dayKeys.length === 0) {
    throw new Error('Respons jadwal bulanan tidak memiliki data hari');
  }

  const year = Number(dayKeys[0].slice(0, 4));
  const existing = (await readYear(monthlyData.id, year))
    ?? _createYearDocument(monthlyData, year);

  const normalizedDays = {};
  for (const [isoDate, day] of Object.entries(monthlyData.jadwal)) {
    normalizedDays[isoDate] = {
      tanggal: day?.tanggal ?? isoDate,
      times: {
        imsak: day?.imsak ?? null,
        subuh: day?.subuh ?? null,
        terbit: day?.terbit ?? null,
        dhuha: day?.dhuha ?? null,
        dzuhur: day?.dzuhur ?? null,
        ashar: day?.ashar ?? null,
        maghrib: day?.maghrib ?? null,
        isya: day?.isya ?? null,
      },
    };
  }

  const nextDoc = {
    ...existing,
    location: {
      id: monthlyData.id,
      kabko: monthlyData.kabko,
      prov: monthlyData.prov,
    },
    updatedAt: new Date().toISOString(),
    days: Object.assign({}, existing.days ?? {}, normalizedDays),
  };

  const path = await writeYear(monthlyData.id, year, nextDoc);
  return {
    year,
    daysWritten: Object.keys(normalizedDays).length,
    path,
  };
}

export async function getCacheFilePath(locationId, year) {
  if (!isNeutralinoRuntime) {
    return _getWebCacheKey(locationId, year);
  }

  const root = await getCacheRootPath();
  return Neutralino.filesystem.getJoinedPath(root, `${locationId}-${year}.json`);
}

export async function readYear(locationId, year) {
  if (!isNeutralinoRuntime) {
    try {
      const raw = await storageGet(_getWebCacheKey(locationId, year));
      const parsed = JSON.parse(raw);
      return _validateCacheDoc(parsed, locationId, year) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  const path = await getCacheFilePath(locationId, year);

  try {
    const raw = await Neutralino.filesystem.readFile(path);
    const parsed = JSON.parse(raw);
    return _validateCacheDoc(parsed, locationId, year) ? parsed : null;
  } catch (_) {
    return null;
  }
}

export async function writeYear(locationId, year, payload) {
  if (!isNeutralinoRuntime) {
    const key = _getWebCacheKey(locationId, year);
    await storageSet(key, JSON.stringify(payload));
    await _writeWebCacheIndex(locationId, year);
    return key;
  }

  await ensureCacheRoot();
  const path = await getCacheFilePath(locationId, year);
  await Neutralino.filesystem.writeFile(path, JSON.stringify(payload, null, 2));
  return path;
}

export async function listLocationYears(locationId) {
  if (!isNeutralinoRuntime) {
    const indexedYears = await _readWebCacheIndex(locationId);
    if (indexedYears.length > 0) {
      return indexedYears;
    }

    return Object.keys(window.localStorage)
      .filter(key => key.startsWith(`${WEB_CACHE_PREFIX}${locationId}:`))
      .map(key => Number(key.slice(key.lastIndexOf(':') + 1)))
      .filter(year => Number.isFinite(year))
      .sort((a, b) => a - b);
  }

  const root = await getCacheRootPath();
  try {
    const stats = await Neutralino.filesystem.getStats(root);
    if (!stats.isDirectory) return [];
  } catch (_) {
    return [];
  }

  const entries = await Neutralino.filesystem.readDirectory(root);

  return entries
    .filter(entry => entry.type === 'FILE')
    .map(entry => entry.entry)
    .filter(name => name.startsWith(`${locationId}-`) && name.endsWith('.json'))
    .map(name => Number(name.slice(locationId.length + 1, locationId.length + 5)))
    .filter(year => Number.isFinite(year))
    .sort((a, b) => a - b);
}

function _getWebCacheKey(locationId, year) {
  return `${WEB_CACHE_PREFIX}${locationId}:${year}`;
}

function _getWebCacheIndexKey(locationId) {
  return `${WEB_CACHE_INDEX_PREFIX}${locationId}`;
}

function _createYearDocument(monthlyData, year) {
  return {
    schemaVersion: SCHEMA_VERSION,
    source: SOURCE_NAME,
    sourceBaseUrl: SOURCE_BASE_URL,
    location: {
      id: monthlyData.id,
      kabko: monthlyData.kabko,
      prov: monthlyData.prov,
    },
    year,
    updatedAt: new Date().toISOString(),
    days: {},
  };
}

function _validateCacheDoc(doc, locationId, year) {
  if (!doc || doc.schemaVersion !== SCHEMA_VERSION) return false;
  if (Number(doc.year) !== Number(year)) return false;
  if (doc.location?.id !== locationId) return false;
  return true;
}

function _assertMonthlyData(monthlyData) {
  if (!monthlyData?.id) throw new Error('Data API tidak memiliki location id');
  if (!monthlyData?.kabko) throw new Error('Data API tidak memiliki kabupaten/kota');
  if (!monthlyData?.prov) throw new Error('Data API tidak memiliki provinsi');
  if (!monthlyData?.jadwal || typeof monthlyData.jadwal !== 'object') {
    throw new Error('Data API tidak memiliki jadwal bulanan yang valid');
  }
}

async function _writeWebCacheIndex(locationId, year) {
  const years = await _readWebCacheIndex(locationId);
  if (!years.includes(Number(year))) {
    years.push(Number(year));
  }

  years.sort((a, b) => a - b);
  await storageSet(_getWebCacheIndexKey(locationId), JSON.stringify(years));
}

async function _readWebCacheIndex(locationId) {
  try {
    const raw = await storageGet(_getWebCacheIndexKey(locationId));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(Number).filter(Number.isFinite).sort((a, b) => a - b)
      : [];
  } catch (_) {
    return [];
  }
}

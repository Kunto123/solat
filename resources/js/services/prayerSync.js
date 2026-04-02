/**
 * services/prayerSync.js - Background sync coordinator for prayer schedule.
 */

import * as prayerApi from './prayerApi.js';
import * as prayerCache from './prayerCache.js';

const DEFAULT_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * Tentukan apakah cache perlu disinkronkan ulang.
 * @param {{ prayerLocationId?: string | null, prayerLastSyncAt?: string | null }} settings
 * @param {Date} [now]
 * @returns {boolean}
 */
export function shouldSync(settings, now = new Date()) {
  if (!settings?.prayerLocationId) return false;
  if (!settings?.prayerLastSyncAt) return true;

  const lastSync = new Date(settings.prayerLastSyncAt);
  if (Number.isNaN(lastSync.getTime())) return true;

  return (now.getTime() - lastSync.getTime()) >= DEFAULT_STALE_AFTER_MS;
}

/**
 * Sinkronkan jadwal per bulan lalu tulis ke cache lokal.
 * @param {{ locationId: string, monthsAhead?: number, now?: Date }} options
 * @returns {Promise<{ locationId: string, locationName: string | null, locationProvince: string | null, rangeStart: string | null, rangeEnd: string | null, monthsRequested: number, monthsSynced: number, syncedAt: string, errors: string[] }>}
 */
export async function syncLocation(options) {
  const locationId = options?.locationId;
  const monthsAhead = Math.max(1, Number(options?.monthsAhead ?? 12));
  const now = options?.now instanceof Date ? options.now : new Date();

  if (!locationId) throw new Error('Location ID belum diatur');

  await prayerCache.ensureCacheRoot();

  const periods = buildPeriods(now, monthsAhead);
  const errors = [];
  let locationName = null;
  let locationProvince = null;
  let monthsSynced = 0;

  for (const period of periods) {
    try {
      const monthlyData = await prayerApi.fetchMonthlySchedule(locationId, period);
      await prayerCache.mergeMonthlySchedule(monthlyData);

      locationName = monthlyData.kabko ?? locationName;
      locationProvince = monthlyData.prov ?? locationProvince;
      monthsSynced += 1;
    } catch (error) {
      errors.push(`${period}: ${error?.message ?? error}`);
    }
  }

  if (monthsSynced === 0) {
    throw new Error(errors[0] ?? 'Sinkronisasi jadwal gagal');
  }

  return {
    locationId,
    locationName,
    locationProvince,
    rangeStart: periods[0] ?? null,
    rangeEnd: periods[periods.length - 1] ?? null,
    monthsRequested: periods.length,
    monthsSynced,
    syncedAt: new Date().toISOString(),
    errors,
  };
}

/**
 * Bangun daftar periode YYYY-MM mulai dari bulan sekarang.
 * @param {Date} startDate
 * @param {number} monthsAhead
 * @returns {string[]}
 */
export function buildPeriods(startDate, monthsAhead) {
  const safeStart = startDate instanceof Date ? startDate : new Date();
  const periods = [];

  for (let offset = 0; offset < monthsAhead; offset += 1) {
    const cursor = new Date(safeStart.getFullYear(), safeStart.getMonth() + offset, 1);
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    periods.push(`${year}-${month}`);
  }

  return periods;
}

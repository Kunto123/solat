/**
 * services/prayerApi.js - Upstream adapter for myQuran v3.
 */

const API_BASE_URL = 'https://api.myquran.com/v3';
const REQUEST_TIMEOUT_MS = 10000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [0, 1000, 3000];

/**
 * Cari lokasi sholat berdasarkan keyword.
 * @param {string} keyword
 * @returns {Promise<Array<{ id: string, lokasi: string }>>}
 */
export async function searchLocations(keyword) {
  const safeKeyword = keyword?.trim();
  if (!safeKeyword) return [];

  const payload = await _requestJson(`/sholat/kabkota/cari/${encodeURIComponent(safeKeyword)}`);
  const items = Array.isArray(payload?.data) ? payload.data : [];

  return items
    .filter(item => item?.id && item?.lokasi)
    .map(item => ({
      id: String(item.id),
      lokasi: String(item.lokasi),
    }));
}

/**
 * Ambil jadwal bulanan untuk satu lokasi.
 * @param {string} locationId
 * @param {string} period - YYYY-MM
 * @returns {Promise<{ id: string, kabko: string, prov: string, jadwal: Record<string, any> }>}
 */
export async function fetchMonthlySchedule(locationId, period) {
  if (!locationId) throw new Error('Location ID belum diatur');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new Error(`Format periode tidak valid: ${period}`);

  const payload = await _requestJson(
    `/sholat/jadwal/${encodeURIComponent(locationId)}/${encodeURIComponent(period)}`
  );

  const data = payload?.data;
  if (!data?.id || !data?.kabko || !data?.prov || typeof data?.jadwal !== 'object') {
    throw new Error(`Respons jadwal ${period} tidak valid`);
  }

  return data;
}

async function _requestJson(path) {
  let lastError = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'GET',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const payload = await response.json();
      if (!payload?.status) {
        throw new Error(payload?.message ?? 'API mengembalikan status gagal');
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) {
        await _sleep(RETRY_DELAYS_MS[attempt + 1] ?? 1000);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw _normalizeError(lastError);
}

function _normalizeError(error) {
  if (!error) return new Error('Permintaan API gagal');
  if (error.name === 'AbortError') {
    return new Error('Permintaan API timeout');
  }
  return error instanceof Error ? error : new Error(String(error));
}

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

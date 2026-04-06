/**
 * services/slideshowServerApi.js
 *
 * API helper untuk mode web berbasis server.
 */

import { isSupportedImageName } from './slideshowLibrary.js';

const UPLOAD_ENDPOINT = '/api/slideshow/upload';

export async function uploadImages(files) {
  const safeFiles = Array.from(files ?? []).filter(file => {
    if (file?.type?.startsWith('image/') || file?.type?.startsWith('video/')) return true;
    return isSupportedImageName(file?.name);
  });

  if (safeFiles.length === 0) {
    return {
      uploaded: [],
      images: [],
    };
  }

  const formData = new FormData();
  safeFiles.forEach(file => {
    formData.append('images', file, file.name);
  });

  const response = await fetch(UPLOAD_ENDPOINT, {
    method: 'POST',
    body: formData,
  });

  const payload = await _readJsonSafely(response);
  if (!response.ok) {
    throw new Error(payload?.error ?? `Upload slideshow gagal (HTTP ${response.status})`);
  }

  return {
    uploaded: Array.isArray(payload?.uploaded) ? payload.uploaded : [],
    images: Array.isArray(payload?.images) ? payload.images : [],
  };
}

async function _readJsonSafely(response) {
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

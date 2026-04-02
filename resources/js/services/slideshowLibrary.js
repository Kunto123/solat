/**
 * services/slideshowLibrary.js
 *
 * Helper untuk sumber slideshow bawaan dan import gambar.
 */

import { isNeutralinoRuntime } from './platform.js';

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
export const WEB_SLIDESHOW_SOURCE = 'browser://slideshow';
export const DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH = './resources/assets/slideshow';
export const DEFAULT_SLIDESHOW_MANIFEST_RELATIVE_PATH = './resources/assets/slideshow/manifest.json';
export const DEFAULT_SLIDESHOW_MANIFEST_URL = './assets/slideshow/manifest.json';
export const DEFAULT_SLIDESHOW_ASSET_BASE_URL = './assets/slideshow';

export function normalizeSlideshowFolder(folderPath) {
  return DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH;
}

export function isSupportedImageName(fileName) {
  const extension = String(fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.has(extension);
}

export function buildBundledImageUrl(fileName) {
  return `${DEFAULT_SLIDESHOW_ASSET_BASE_URL}/${encodeURIComponent(String(fileName ?? ''))}`;
}

export async function resolveNeutralinoFolderPath(folderPath = DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH) {
  if (!isNeutralinoRuntime) {
    return normalizeSlideshowFolder(folderPath);
  }

  return Neutralino.filesystem.getAbsolutePath(normalizeSlideshowFolder(folderPath));
}

export async function ensureNeutralinoFolder(folderPath = DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH) {
  if (!isNeutralinoRuntime) {
    return normalizeSlideshowFolder(folderPath);
  }

  const absPath = await resolveNeutralinoFolderPath(folderPath);

  try {
    const stats = await Neutralino.filesystem.getStats(absPath);
    if (!stats.isDirectory) {
      throw new Error(`Path slideshow bukan folder: ${absPath}`);
    }
  } catch (_) {
    await Neutralino.filesystem.createDirectory(absPath);
  }

  return absPath;
}

export async function listNeutralinoFolderImages(folderPath = DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH) {
  if (!isNeutralinoRuntime) {
    return [];
  }

  const absPath = await resolveNeutralinoFolderPath(folderPath);
  const entries = await Neutralino.filesystem.readDirectory(absPath);

  return entries
    .filter(entry => entry.type === 'FILE' && isSupportedImageName(entry.entry))
    .map(entry => entry.entry)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
}

export async function writeBundledManifest(folderPath = DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH) {
  if (!isNeutralinoRuntime) {
    return [];
  }

  await ensureNeutralinoFolder(folderPath);
  const images = await listNeutralinoFolderImages(folderPath);
  const manifestPath = await Neutralino.filesystem.getAbsolutePath(
    DEFAULT_SLIDESHOW_MANIFEST_RELATIVE_PATH
  );

  await Neutralino.filesystem.writeFile(
    manifestPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        images,
      },
      null,
      2
    )
  );

  return images;
}

export async function loadBundledManifestImages() {
  const response = await fetch(DEFAULT_SLIDESHOW_MANIFEST_URL, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Manifest slideshow tidak dapat dimuat (${response.status})`);
  }

  const payload = await response.json();
  const images = Array.isArray(payload) ? payload : payload?.images;

  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map(fileName => String(fileName ?? '').trim())
    .filter(fileName => fileName.length > 0 && isSupportedImageName(fileName));
}

export async function importImagesToDefaultFolder(sourcePaths) {
  if (!isNeutralinoRuntime) {
    throw new Error('Import ke folder slideshow hanya tersedia di runtime Neutralino');
  }

  const defaultFolder = await ensureNeutralinoFolder(DEFAULT_SLIDESHOW_FOLDER_RELATIVE_PATH);
  const importedNames = [];

  for (const rawSourcePath of sourcePaths ?? []) {
    const sourcePath = String(rawSourcePath ?? '').trim();
    const sourceFileName = _getFileName(sourcePath);

    if (!sourcePath || !isSupportedImageName(sourceFileName)) {
      continue;
    }

    const safeName = _sanitizeFileName(sourceFileName);
    const targetName = await _getUniqueFileName(defaultFolder, safeName);
    const targetPath = await Neutralino.filesystem.getJoinedPath(defaultFolder, targetName);

    await Neutralino.filesystem.copy(sourcePath, targetPath, {
      recursive: false,
      overwrite: false,
      skip: false,
    });

    importedNames.push(targetName);
  }

  await writeBundledManifest(defaultFolder);

  return {
    folderPath: defaultFolder,
    importedNames,
  };
}

function _getFileName(filePath) {
  return String(filePath ?? '').split(/[\\/]/).pop() ?? '';
}

function _sanitizeFileName(fileName) {
  const safeName = String(fileName ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (safeName && safeName !== '.' && safeName !== '..') {
    return safeName;
  }

  return `slideshow-${Date.now()}.jpg`;
}

async function _getUniqueFileName(folderPath, preferredName) {
  const extension = preferredName.includes('.')
    ? `.${preferredName.split('.').pop()}`
    : '';
  const stem = extension
    ? preferredName.slice(0, -(extension.length))
    : preferredName;

  let attempt = 0;
  while (attempt < 500) {
    const candidate = attempt === 0
      ? preferredName
      : `${stem}-${attempt + 1}${extension}`;
    const candidatePath = await Neutralino.filesystem.getJoinedPath(folderPath, candidate);

    try {
      await Neutralino.filesystem.getStats(candidatePath);
      attempt += 1;
    } catch (_) {
      return candidate;
    }
  }

  return `${stem}-${Date.now()}${extension}`;
}

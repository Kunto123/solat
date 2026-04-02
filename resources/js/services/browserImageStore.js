/**
 * services/browserImageStore.js
 *
 * Penyimpanan gambar slideshow untuk mode web menggunakan IndexedDB.
 */

const DB_NAME = 'masjid_signage_web';
const STORE_NAME = 'slideshow_images';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

/**
 * Buka file picker gambar. Prioritaskan picker modern, fallback ke input file.
 * @returns {Promise<File[] | null>}
 */
export async function pickImages() {
  if (window.showDirectoryPicker) {
    try {
      const directoryHandle = await window.showDirectoryPicker({
        mode: 'read',
      });

      const files = await _readDirectoryImages(directoryHandle);
      return files.length > 0 ? files : null;
    } catch (_) {
      return null;
    }
  }

  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple: true,
        excludeAcceptAllOption: false,
        types: [
          {
            description: 'Image files',
            accept: {
              'image/*': ['.jpg', '.jpeg', '.png', '.webp'],
            },
          },
        ],
      });

      const files = await Promise.all(handles.map(handle => handle.getFile()));
      return _filterImages(files);
    } catch (_) {
      return null;
    }
  }

  return new Promise(resolve => {
    const input = document.createElement('input');
    let settled = false;

    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    input.setAttribute('webkitdirectory', '');
    document.body.appendChild(input);

    const cleanup = () => {
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    input.addEventListener('change', () => {
      settled = true;
      const files = _filterImages(Array.from(input.files ?? []));
      cleanup();
      resolve(files.length > 0 ? files : null);
    }, { once: true });

    window.addEventListener('focus', () => {
      setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(null);
        }
      }, 300);
    }, { once: true });

    input.click();
  });
}

/**
 * Ganti seluruh koleksi gambar slideshow.
 * @param {File[]} files
 * @returns {Promise<number>}
 */
export async function replaceImages(files) {
  const safeFiles = _filterImages(files);
  const db = await _openDb();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    store.clear();
    safeFiles.forEach((file, index) => {
      store.put({
        id: `${Date.now()}-${index}`,
        order: index,
        name: file.name,
        mimeType: file.type,
        size: file.size,
        blob: file,
        updatedAt: Date.now(),
      });
    });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Gagal menyimpan gambar slideshow'));
  });

  db.close();
  return safeFiles.length;
}

/**
 * Ambil seluruh gambar slideshow yang tersimpan.
 * @returns {Promise<Array<{ id: string, order: number, name: string, mimeType?: string, blob: Blob }>>}
 */
export async function loadImages() {
  const db = await _openDb();

  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();

    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error('Gagal membaca gambar slideshow'));
  });

  db.close();

  return Array.isArray(records)
    ? records.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    : [];
}

function _filterImages(files) {
  return Array.from(files ?? []).filter(file => {
    if (file?.type?.startsWith('image/')) return true;
    const extension = String(file?.name ?? '').split('.').pop()?.toLowerCase() ?? '';
    return IMAGE_EXTENSIONS.has(extension);
  });
}

async function _readDirectoryImages(directoryHandle) {
  const files = [];
  await _walkDirectory(directoryHandle, files);
  return _filterImages(files);
}

async function _walkDirectory(directoryHandle, files) {
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      files.push(file);
      continue;
    }

    if (entry.kind === 'directory') {
      await _walkDirectory(entry, files);
    }
  }
}

function _openDb() {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB tidak dapat dibuka'));
  });
}

// 知错 · 本地照片仓库（IndexedDB，失败回退 localStorage）
// 用于 Cloudflare 版本的「照片只存本机」：题目数据在云端，原图留在当前浏览器。
const DB_NAME = 'zhicuo-local-images';
const STORE = 'images';
const FALLBACK_PREFIX = 'zhicuo.img.';
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return `img_${crypto.randomUUID()}`;
  return `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function saveLocalImage(dataUrl, id = '') {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    throw new Error('图片数据无效');
  }
  const key = id || newId();
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(dataUrl, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('图片保存失败'));
    });
    return key;
  } catch (err) {
    try {
      localStorage.setItem(FALLBACK_PREFIX + key, dataUrl);
      return key;
    } catch (fallbackErr) {
      throw new Error('本机浏览器存储空间不足，照片保存失败');
    }
  }
}

export async function getLocalImage(id) {
  if (!id) return '';
  try {
    const db = await openDb();
    const data = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || '');
      req.onerror = () => reject(req.error);
    });
    if (data) return data;
  } catch (err) {
    /* 回退 localStorage */
  }
  try {
    return localStorage.getItem(FALLBACK_PREFIX + id) || '';
  } catch (err) {
    return '';
  }
}

export async function deleteLocalImage(id) {
  if (!id) return;
  try {
    const db = await openDb();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {
    /* ignore */
  }
  try {
    localStorage.removeItem(FALLBACK_PREFIX + id);
  } catch (err) {
    /* ignore */
  }
}

export function localImageRef(id) {
  return id ? `local:${id}` : '';
}

export function localImageId(ref) {
  return typeof ref === 'string' && ref.startsWith('local:') ? ref.slice(6) : '';
}

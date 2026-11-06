// 知错 · API 客户端
import { getLocalImage, localImageId } from './imageStore.js';

const BASE = '';

async function hydrateLocalImages(node) {
  if (Array.isArray(node)) {
    for (const item of node) await hydrateLocalImages(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const id = localImageId(node.imageUrl);
  if (id) {
    const dataUrl = await getLocalImage(id);
    if (dataUrl) node.imageUrl = dataUrl;
  }
  for (const key of Object.keys(node)) {
    if (key === 'imageUrl') continue;
    if (node[key] && typeof node[key] === 'object') await hydrateLocalImages(node[key]);
  }
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text?.slice(0, 200) || '服务返回了无法解析的内容' };
  }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
      const next = `/${location.hash || '#/dashboard'}`;
      location.href = `/login?next=${encodeURIComponent(next)}`;
    }
    const err = new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  await hydrateLocalImages(data);
  return data;
}

function qs(params = {}) {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  del: (path) => request(path, { method: 'DELETE' }),

  bootstrap: () => request('/api/bootstrap'),
  health: () => request('/api/health'),
  stats: () => request('/api/stats'),
  questions: (params) => request(`/api/questions${qs(params)}`),
  question: (id) => request(`/api/questions/${encodeURIComponent(id)}`),
  createQuestion: (data) => request('/api/questions', { method: 'POST', body: JSON.stringify(data) }),
  updateQuestion: (id, data) =>
    request(`/api/questions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteQuestion: (id) => request(`/api/questions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  attempt: (id, data) =>
    request(`/api/questions/${encodeURIComponent(id)}/attempts`, { method: 'POST', body: JSON.stringify(data) }),
  generateVariants: (id, count = 2) =>
    request(`/api/questions/${encodeURIComponent(id)}/variants`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),

  analyze: (data) => request('/api/analyze', { method: 'POST', body: JSON.stringify(data) }),
  testAI: () => request('/api/ai/test', { method: 'POST', body: '{}' }),
  settings: () => request('/api/settings'),
  updateSettings: (data) => request('/api/settings', { method: 'PUT', body: JSON.stringify(data) }),
  practiceQueue: (params) => request(`/api/practice/queue${qs(params)}`),
  exportUrl: '/api/export',
};

// 把 File/Blob 压缩为 JPEG dataURL（长边 ≤ 1600）
export function fileToDataUrl(file, { maxSize = 1600, quality = 0.86 } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('请选择图片文件'));
      return;
    }
    if (file.size > 18 * 1024 * 1024) {
      reject(new Error('图片超过 18MB，请压缩后再试'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    img.src = url;
  });
}

export function canvasToDataUrl(canvas, quality = 0.9) {
  return canvas.toDataURL('image/jpeg', quality);
}

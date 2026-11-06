// 知错 · UI 基础组件与工具
import { icon } from './icons.js';
export { icon };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const SUBJECT_CLASS = {
  数学: 'math',
  物理: 'physics',
  化学: 'chemistry',
  英语: 'english',
  语文: 'chinese',
  生物: 'biology',
  历史: 'history',
  地理: 'geography',
  政治: 'politics',
};

export function subjectClass(subject) {
  return SUBJECT_CLASS[subject] || 'other';
}

export function masteryLabel(v) {
  const n = Number(v) || 0;
  if (n >= 80) return { label: '已掌握', tone: 'high' };
  if (n >= 55) return { label: '较熟练', tone: 'mid' };
  if (n >= 30) return { label: '薄弱', tone: 'low' };
  return { label: '未掌握', tone: 'new' };
}

export function difficultyLabel(n) {
  return ['入门', '基础', '中等', '较难', '压轴'][Number(n) - 1] || '中等';
}

export function difficultyDots(n) {
  const level = Math.max(1, Math.min(5, Number(n) || 3));
  return Array.from({ length: 5 }, (_, i) => `<i class="${i < level ? 'on' : ''}"></i>`).join('');
}

export function fmtDate(iso, style = 'short') {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (style === 'long') return `${y}年${m}月${day}日`;
  if (style === 'md') return `${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')}`;
  if (style === 'rel') return fmtRelative(iso);
  if (style === 'full') {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}.${String(m).padStart(2, '0')}.${String(day).padStart(2, '0')} ${hh}:${mm}`;
  }
  return `${m}月${day}日`;
}

export function fmtRelative(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const minute = 60000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return '刚刚';
  if (abs < hour) return `${Math.floor(abs / minute)} 分钟前`;
  if (abs < day) return `${Math.floor(abs / hour)} 小时前`;
  if (abs < 2 * day && diff >= 0) return '昨天';
  if (diff < 0) {
    const n = Math.ceil(abs / day);
    return n <= 1 ? '今天到期' : `${n} 天后`;
  }
  if (abs < 30 * day) return `${Math.floor(abs / day)} 天前`;
  if (abs < 365 * day) return `${Math.floor(abs / (30 * day))} 个月前`;
  return `${Math.floor(abs / (365 * day))} 年前`;
}

let toastTimer = 0;
export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root') || document.body;
  const node = document.createElement('div');
  const iconName = type === 'error' ? 'alert' : type === 'info' ? 'spark' : 'circle-check';
  node.className = `toast toast-${type}`;
  node.setAttribute('role', 'status');
  node.innerHTML = `<span class="toast-ico">${icon(iconName, 18)}</span><span>${escapeHtml(message)}</span>`;
  root.appendChild(node);
  requestAnimationFrame(() => node.classList.add('in'));
  clearTimeout(toastTimer);
  setTimeout(() => {
    node.classList.remove('in');
    setTimeout(() => node.remove(), 260);
  }, 2800);
}

// ---------- overlay 基础 ----------
const stack = [];
let bodyLock = 0;

function lockBody(lock) {
  bodyLock = Math.max(0, bodyLock + (lock ? 1 : -1));
  document.body.classList.toggle('overlay-open', bodyLock > 0);
}

function overlayHost() {
  let host = document.getElementById('overlay-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'overlay-root';
    document.body.appendChild(host);
  }
  return host;
}

function dismissTop() {
  const top = stack[stack.length - 1];
  if (top) top.close();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) dismissTop();
});

function buildOverlay(inner, { onClose, dismissible = true } = {}) {
  const host = overlayHost();
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  wrap.innerHTML = `<div class="overlay-backdrop" data-close="1"></div>${inner}`;
  const entry = {
    root: wrap,
    close() {
      if (entry.closed) return;
      entry.closed = true;
      const idx = stack.indexOf(entry);
      if (idx >= 0) stack.splice(idx, 1);
      wrap.classList.remove('in');
      lockBody(false);
      try {
        onClose && onClose();
      } catch (err) {
        console.error(err);
      }
      setTimeout(() => wrap.remove(), 240);
    },
  };
  wrap.addEventListener('click', (e) => {
    const t = e.target.closest('[data-close]');
    if (t && dismissible) entry.close();
  });
  host.appendChild(wrap);
  stack.push(entry);
  lockBody(true);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    const focusable = wrap.querySelector('input, textarea, button, [tabindex]');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 60);
  });
  return entry;
}

export function closeDrawer() {
  const top = stack[stack.length - 1];
  if (top) top.close();
}

export function openDrawer({ title, subtitle = '', body = '', footer = '', width = 560, onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay';
  const inner = document.createElement('aside');
  inner.className = 'drawer';
  inner.setAttribute('role', 'dialog');
  inner.setAttribute('aria-modal', 'true');
  inner.style.width = `min(${width}px, 100vw)`;
  inner.innerHTML = `
    <header class="drawer-head">
      <div class="drawer-heading">
        ${subtitle ? `<div class="drawer-sub">${escapeHtml(subtitle)}</div>` : ''}
        <h2 class="drawer-title">${escapeHtml(title || '')}</h2>
      </div>
      <button class="btn btn-icon btn-ghost" data-close="1" aria-label="关闭">${icon('x', 20)}</button>
    </header>
    <div class="drawer-body"></div>
    ${footer ? '<footer class="drawer-foot"></footer>' : ''}
  `;
  const bodyEl = inner.querySelector('.drawer-body');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body || '';
  if (footer) {
    const foot = inner.querySelector('.drawer-foot');
    if (footer instanceof Node) foot.appendChild(footer);
    else foot.innerHTML = footer;
  }
  wrap.appendChild(inner);
  const host = overlayHost();
  wrap.innerHTML = '';
  wrap.className = 'overlay drawer-overlay';
  wrap.innerHTML = '<div class="overlay-backdrop" data-close="1"></div>';
  wrap.appendChild(inner);
  host.appendChild(wrap);
  const entry = {
    root: inner,
    wrap,
    close() {
      if (entry.closed) return;
      entry.closed = true;
      const idx = stack.indexOf(entry);
      if (idx >= 0) stack.splice(idx, 1);
      wrap.classList.remove('in');
      lockBody(false);
      try {
        onClose && onClose();
      } catch (err) {
        console.error(err);
      }
      setTimeout(() => wrap.remove(), 240);
    },
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) entry.close();
  });
  stack.push(entry);
  lockBody(true);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    const focusable = inner.querySelector('input, textarea, button');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 60);
  });
  return entry;
}

export function openModal({ title = '', subtitle = '', body = '', actions = [], width = 520, onClose, dismissible = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay modal-overlay';
  wrap.innerHTML = `
    <div class="overlay-backdrop" data-close="1"></div>
    <div class="modal" role="dialog" aria-modal="true" style="width:min(${width}px, calc(100vw - 32px))">
      <header class="modal-head">
        <div>
          ${subtitle ? `<div class="modal-sub">${escapeHtml(subtitle)}</div>` : ''}
          <h2 class="modal-title">${escapeHtml(title)}</h2>
        </div>
        ${dismissible ? `<button class="btn btn-icon btn-ghost" data-close="1" aria-label="关闭">${icon('x', 20)}</button>` : ''}
      </header>
      <div class="modal-body"></div>
      <footer class="modal-foot"></footer>
    </div>
  `;
  const bodyEl = wrap.querySelector('.modal-body');
  if (body instanceof Node) bodyEl.appendChild(body);
  else bodyEl.innerHTML = body || '';
  const foot = wrap.querySelector('.modal-foot');
  const host = overlayHost();
  host.appendChild(wrap);

  const entry = {
    root: wrap,
    close() {
      if (entry.closed) return;
      entry.closed = true;
      const idx = stack.indexOf(entry);
      if (idx >= 0) stack.splice(idx, 1);
      wrap.classList.remove('in');
      lockBody(false);
      try {
        onClose && onClose();
      } catch (err) {
        console.error(err);
      }
      setTimeout(() => wrap.remove(), 240);
    },
  };

  actions.forEach((action) => {
    const btn = document.createElement('button');
    btn.className = `btn ${action.type === 'primary' ? 'btn-primary' : action.type === 'danger' ? 'btn-red' : 'btn-line'}`;
    btn.type = 'button';
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      if (btn.dataset.busy) return;
      btn.dataset.busy = '1';
      try {
        const result = action.onClick ? await action.onClick(entry) : undefined;
        if (result !== false && action.close !== false) entry.close();
      } finally {
        delete btn.dataset.busy;
      }
    });
    foot.appendChild(btn);
  });
  if (!actions.length) foot.remove();

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') && dismissible) entry.close();
  });
  stack.push(entry);
  lockBody(true);
  requestAnimationFrame(() => {
    wrap.classList.add('in');
    const focusable = wrap.querySelector('input, textarea, button');
    if (focusable) setTimeout(() => focusable.focus({ preventScroll: true }), 60);
  });
  return entry;
}

export function confirmDialog({ title = '确认操作', message = '', confirmText = '确认', cancelText = '取消', danger = false, onConfirm } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openModal({
      title,
      body: `<p class="confirm-text">${escapeHtml(message)}</p>`,
      width: 420,
      actions: [
        { label: cancelText, type: 'ghost', onClick: () => finish(false) },
        {
          label: confirmText,
          type: danger ? 'danger' : 'primary',
          onClick: async (entry) => {
            if (onConfirm) await onConfirm();
            finish(true);
            entry.close();
            return false;
          },
        },
      ],
      onClose: () => finish(false),
    });
  });
}

export function debounce(fn, ms = 300) {
  let timer = 0;
  function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  }
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

export function emptyState(opts = {}, maybeOpts) {
  const target = opts instanceof Element ? opts : null;
  const o = target ? maybeOpts || {} : opts;
  const {
    iconName = 'bookOpen',
    title = '这里还空着',
    desc = '',
    actionLabel = '',
    actionId = 'empty-action',
  } = o;
  const html = `<div class="empty">
    <div class="empty-art">${icon(iconName, 30)}</div>
    <h3 class="empty-title">${escapeHtml(title)}</h3>
    ${desc ? `<p class="empty-desc">${escapeHtml(desc)}</p>` : ''}
    ${actionLabel ? `<button class="btn btn-line btn-sm" id="${actionId}">${escapeHtml(actionLabel)}</button>` : ''}
  </div>`;
  if (target) target.innerHTML = html;
  return html;
}

export function loadingBlock(text = '正在整理错题…') {
  const html = `<div class="loading-block"><span class="spinner"></span><span>${escapeHtml(text)}</span></div>`;
  if (text instanceof Element) {
    text.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>正在加载…</span></div>`;
    return '';
  }
  return html;
}

export function ring(value, size = 64, stroke = 5) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  const tone = v >= 80 ? 'high' : v >= 55 ? 'mid' : v >= 30 ? 'low' : 'new';
  return `<span class="ring ring-${tone}" style="width:${size}px;height:${size}px;font-size:${Math.max(14, Math.round(size * 0.3))}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-bar" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${dash} ${c}" stroke-linecap="round" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <span class="ring-text"><b>${Math.round(v)}</b><small>%</small></span>
  </span>`;
}

export function mountSparkline(el, values = [], { height = 40, color = 'var(--red)', fill = 'rgba(201,75,54,.12)' } = {}) {
  if (!el) return;
  const w = el.clientWidth || 240;
  const h = height;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [values.length <= 1 ? 0 : (i / (values.length - 1)) * w, h - (v / max) * (h - 4) - 2]);
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const area = `${d} L${w},${h} L0,${h} Z`;
  el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path d="${area}" fill="${fill}"></path><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

export function pctWidth(value, total) {
  if (!total) return '0%';
  return `${Math.round((Number(value) / total) * 100)}%`;
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, Number(n) || 0));
}

export function formatNum(n) {
  const v = Number(n) || 0;
  return v >= 10000 ? `${(v / 10000).toFixed(1)}w` : String(v);
}

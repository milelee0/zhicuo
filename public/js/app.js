// 知错 · 应用外壳与路由
import { api } from './api.js';
import { icon } from './icons.js';
import { $, $$, escapeHtml, toast, confirmDialog, openModal, fmtDate, subjectClass } from './ui.js';

const ROUTES = {
  dashboard: '总览',
  book: '错题本',
  add: '录入错题',
  practice: '举一反三',
  paper: '组卷打印',
  mastery: '掌握度',
  settings: '设置',
};
const KICKERS = {
  dashboard: 'WORKDESK / 今日',
  book: 'ARCHIVE / 错题档案',
  add: 'INTAKE / 拍照录入',
  practice: 'DRILL / 举一反三',
  paper: 'PRESS / 组卷打印',
  mastery: 'PROGRESS / 掌握轨迹',
  settings: 'SYSTEM / 设置',
};
const TITLES = {
  dashboard: '总览 · 知错',
  book: '错题本 · 知错',
  add: '录入错题 · 知错',
  practice: '举一反三 · 知错',
  paper: '组卷打印 · 知错',
  mastery: '掌握度 · 知错',
  settings: '设置 · 知错',
};

const appState = { settings: null, meta: null, stats: null, features: {} };
let currentModule = null;
let currentName = '';
let cleanups = [];
let renderToken = 0;
let shellLoading = false;

function parseHash() {
  let raw = location.hash.replace(/^#\/?/, '');
  if (!raw) return { name: 'dashboard', query: {} };
  const [path, search = ''] = raw.split('?');
  const name = path.split('/')[0] || 'dashboard';
  const query = {};
  new URLSearchParams(search).forEach((v, k) => {
    query[k] = v;
  });
  return { name: ROUTES[name] ? name : 'dashboard', query };
}

function navigate(hash) {
  if (location.hash === hash) {
    render();
  } else {
    location.hash = hash;
  }
}

function runCleanups() {
  cleanups.forEach((fn) => {
    try {
      fn();
    } catch (err) {
      console.error(err);
    }
  });
  cleanups = [];
  if (window.__zhicuoOpenQuestion) delete window.__zhicuoOpenQuestion;
}

async function loadShell() {
  if (shellLoading) return;
  shellLoading = true;
  try {
    const [boot, stats] = await Promise.all([api.bootstrap(), api.stats()]);
    appState.settings = boot.settings;
    appState.meta = boot.meta;
    appState.features = boot.features || {};
    appState.stats = stats;
    paintShell();
  } catch (err) {
    console.error('shell load failed', err);
    const ai = $('#ai-status');
    if (ai) {
      ai.classList.remove('live');
      ai.querySelector('.txt').textContent = '服务连接失败';
    }
  } finally {
    shellLoading = false;
  }
}

function paintShell() {
  const stats = appState.stats;
  const settings = appState.settings;
  if (stats) {
    const due = stats.totals?.due ?? 0;
    const dueEl = $('#due-count');
    if (dueEl) dueEl.innerHTML = `${due}<small>道</small>`;
    const navCount = $('#nav-count');
    if (navCount) {
      navCount.textContent = due > 99 ? '99+' : String(due);
      navCount.hidden = due === 0;
    }
  }
  if (settings?.ai) {
    const ai = $('#ai-status');
    if (ai) {
      const live = settings.ai.mode === 'live';
      ai.classList.toggle('live', live);
      ai.querySelector('.txt').textContent = live
        ? `AI 已连接 · ${settings.ai.model || '模型'}`
        : '演示模式 · 未配置 AI';
      ai.title = live ? `已连接 ${settings.ai.model}` : '未配置 AI 密钥，点击前往设置';
    }
  }
}

function setActiveNav(name) {
  $$('.nav-link').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  const kicker = $('#page-kicker');
  if (kicker) kicker.textContent = KICKERS[name] || 'WORKDESK';
  document.title = TITLES[name] || '知错 · 智能错题本';
  const topAdd = $('#top-add');
  if (topAdd) topAdd.hidden = name === 'add';
}

function loadingPage() {
  return `<div class="page">
    <div class="skeleton" style="width:140px;height:10px;margin-bottom:18px"></div>
    <div class="skeleton" style="width:min(460px,72%);height:44px;margin-bottom:14px"></div>
    <div class="skeleton" style="width:min(560px,88%);height:14px;margin-bottom:34px"></div>
    <div class="grid grid-4">
      ${Array.from({ length: 4 })
        .map(
          () =>
            '<div class="card card-pad"><div class="skeleton" style="width:40%;height:11px;margin-bottom:18px"></div><div class="skeleton" style="width:56%;height:34px"></div></div>'
        )
        .join('')}
    </div>
    <div class="card card-pad mt-24"><div class="skeleton" style="width:100%;height:180px"></div></div>
  </div>`;
}

function errorPage(message) {
  return `<div class="page"><div class="card"><div class="error-block">
    <span class="err-ico">${icon('alert', 24)}</span>
    <div><h3 class="serif" style="font-size:20px">这一页没有翻开</h3>
    <p class="muted small" style="margin-top:6px">${escapeHtml(message || '加载失败，请检查服务是否启动')}</p></div>
    <button class="btn btn-line btn-sm" id="retry-view">${icon('refresh', 15)} 重新加载</button>
  </div></div></div>`;
}

async function render() {
  const token = ++renderToken;
  const { name, query } = parseHash();
  const root = $('#view');
  if (!root) return;

  runCleanups();
  try {
    currentModule?.destroy?.();
  } catch (err) {
    console.error(err);
  }
  currentModule = null;
  currentName = name;
  setActiveNav(name);
  root.innerHTML = loadingPage();
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  if (!appState.meta) await loadShell();
  if (token !== renderToken) return;

  try {
    const mod = await import(`./views/${name}.js`);
    if (token !== renderToken) return;
    currentModule = mod;
    const ctx = {
      navigate,
      toast,
      confirm: confirmDialog,
      refreshShell: loadShell,
      openQuestion: (id) => {
        if (typeof window.__zhicuoOpenQuestion === 'function') {
          window.__zhicuoOpenQuestion(id);
        } else {
          navigate(`#/book?open=${encodeURIComponent(id)}`);
        }
      },
      state: appState,
      query,
      onCleanup: (fn) => {
        if (typeof fn === 'function') cleanups.push(fn);
      },
    };
    await mod.mount(root, ctx);
    if (token !== renderToken) return;
    if (typeof mod.openQuestion === 'function') window.__zhicuoOpenQuestion = mod.openQuestion;
    // 侧栏数据可能因视图操作变化，静默刷新
    if (name !== 'add') loadShell();
  } catch (err) {
    console.error(`view ${name} failed`, err);
    if (token !== renderToken) return;
    root.innerHTML = errorPage(err.message || '加载失败');
    $('#retry-view')?.addEventListener('click', () => render());
  }
}

// ---------------- 全局搜索 ----------------
let searchOpen = false;

function openSearch() {
  if (searchOpen) return;
  searchOpen = true;
  const body = document.createElement('div');
  body.className = 'cmdk';
  body.innerHTML = `
    <div class="cmdk-input-wrap">
      ${icon('search', 18)}
      <input class="cmdk-input" type="search" placeholder="搜索题干、答案或知识点…" autocomplete="off" />
      <span class="kbd">ESC</span>
    </div>
    <div class="cmdk-hint">输入关键词，回车打开第一条结果</div>
    <div class="cmdk-results"><div class="loading-block"><span class="spinner"></span>正在翻找错题…</div></div>
  `;
  const modal = openModal({ title: '搜索错题', body, width: 620, onClose: () => (searchOpen = false) });
  const input = body.querySelector('.cmdk-input');
  const results = body.querySelector('.cmdk-results');
  let timer = 0;
  let items = [];

  const paint = (list, keyword) => {
    items = list;
    if (!list.length) {
      results.innerHTML = `<div class="cmdk-empty">${keyword ? '没有找到相关错题' : '错题本还是空的，先录入一道吧'}</div>`;
      return;
    }
    results.innerHTML = list
      .map(
        (q, i) => `<button class="cmdk-item" data-id="${escapeHtml(q.id)}" data-index="${i}">
          <span class="cmdk-no">${String(i + 1).padStart(2, '0')}</span>
          <span class="cmdk-main">
            <span class="cmdk-text">${escapeHtml(q.text).slice(0, 120)}</span>
            <span class="cmdk-meta">
              <span class="subj subj-${subjectClass(q.subject)}">${escapeHtml(q.subject || '未分类')}</span>
              <span>掌握度 ${Number(q.mastery) || 0}%</span>
              <span>${escapeHtml((q.knowledgePoints || []).slice(0, 2).join(' · '))}</span>
            </span>
          </span>
          <span class="cmdk-arrow">${icon('arrow-right', 16)}</span>
        </button>`
      )
      .join('');
    $$('.cmdk-item', results).forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.close();
        navigate(`#/book?open=${encodeURIComponent(btn.dataset.id)}`);
      });
    });
  };

  const search = async (keyword) => {
    try {
      const data = await api.questions({ q: keyword || undefined, limit: 10, sort: 'recent' });
      paint(data.items || [], keyword);
    } catch (err) {
      results.innerHTML = `<div class="cmdk-empty">搜索失败：${escapeHtml(err.message)}</div>`;
    }
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(input.value.trim()), 220);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && items[0]) {
      modal.close();
      navigate(`#/book?open=${encodeURIComponent(items[0].id)}`);
    }
  });
  search('');
  setTimeout(() => input.focus(), 80);
}

// ---------------- 启动 ----------------
function bindShell() {
  $$('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, 18);
  });
  const settingsLink = $('#settings-link');
  if (settingsLink) settingsLink.innerHTML = icon('settings', 17);
  const ai = $('#ai-status');
  ai?.addEventListener('click', () => navigate('#/settings'));
  $('#search-trigger')?.addEventListener('click', openSearch);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openSearch();
    }
  });
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/dashboard');
}

async function boot() {
  bindShell();
  await loadShell();
  await render();
}

boot();

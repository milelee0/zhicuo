// 知错 · 设置
import { api } from '../api.js';
import { $, escapeHtml, icon, toast, loadingBlock } from '../ui.js';

let savedSettings = null;

function settingsShell(settings, stats) {
  const ai = settings.ai || {};
  const live = ai.mode === 'live';
  const count = stats?.totals?.questions ?? 0;
  return `<div class="page settings-page">
    <header class="page-head">
      <div>
        <div class="page-kicker">SYSTEM / 设置</div>
        <h1 class="page-title">把工具，调成<em>顺手的样子</em>。</h1>
        <p class="page-sub">配置 AI 服务后，拍照识别、错因诊断和变式题生成会使用真实模型；不配置也能以演示模式体验完整流程。</p>
      </div>
      <div class="page-actions">
        <span class="badge ${live ? 'badge-sage' : 'badge-gold'}">${live ? '● AI 已连接' : '○ 演示模式'}</span>
      </div>
    </header>

    <div class="settings-layout">
      <section class="card settings-main">
        <div class="card-head">
          <div class="card-title">${icon('spark', 18)} AI 服务</div>
          <span class="card-sub">OpenAI 兼容接口</span>
        </div>
        <div class="card-body">
          <div class="settings-note">
            ${icon('brain', 18)}
            <div>
              <strong>关于密钥</strong>
              <p>密钥只保存在本机 <code>data/db.json</code>，不会上传到本项目之外；请求仅发往你填写的 AI 服务地址。</p>
            </div>
          </div>

          <form id="ai-form" autocomplete="off">
            <div class="field">
              <label class="label" for="set-base">API 地址 <span class="req">*</span><span class="hint">OpenAI 兼容 base URL</span></label>
              <input class="input" id="set-base" value="${escapeHtml(ai.baseUrl || 'https://api.deepseek.com/v1')}" placeholder="https://api.deepseek.com/v1" />
              <p class="field-hint">会请求 <code>{baseUrl}/chat/completions</code>。DeepSeek、通义、Moonshot、OpenAI 均可。</p>
            </div>

            <div class="setting-grid">
              <div class="field">
                <label class="label" for="set-model">文本模型 <span class="req">*</span></label>
                <input class="input" id="set-model" value="${escapeHtml(ai.model || 'deepseek-chat')}" placeholder="deepseek-chat" />
              </div>
              <div class="field">
                <label class="label" for="set-vision">视觉模型 <span class="hint">拍照识别用</span></label>
                <input class="input" id="set-vision" value="${escapeHtml(ai.visionModel || '')}" placeholder="如 qwen-vl-max / gpt-4o" />
              </div>
            </div>

            <div class="field">
              <label class="label" for="set-key">API Key <span class="hint">${ai.hasKey ? '已保存，留空则保持不变' : '未配置'}</span></label>
              <div class="key-field">
                <input class="input" id="set-key" type="password" placeholder="${ai.hasKey ? '••••••••••••••••（已保存）' : 'sk-...'}" />
                <button type="button" class="btn btn-icon btn-line" id="toggle-key" aria-label="显示或隐藏密钥">${icon('eye', 16)}</button>
              </div>
              <label class="check mt-8"><input type="checkbox" id="clear-key" ${ai.hasKey ? '' : 'disabled'} /> 清除已保存的密钥，恢复演示模式</label>
            </div>

            <div class="settings-actions">
              <button type="submit" class="btn btn-red" id="save-ai">${icon('check', 17)} 保存设置</button>
              <button type="button" class="btn btn-line" id="test-ai">${icon('practice', 16)} 测试连接</button>
              <span class="test-result" id="test-result"></span>
            </div>
          </form>

          <div class="model-guide">
            <div class="model-guide-title">推荐组合</div>
            <div class="model-guide-grid">
              <div class="mg-item">
                <span class="tag tag-blue">文本 + 解析</span>
                <p><code>deepseek-chat</code> 或 <code>qwen-plus</code>，性价比高，中文解题稳定。</p>
              </div>
              <div class="mg-item">
                <span class="tag tag-red">拍照识别</span>
                <p>需要独立视觉模型，如 <code>qwen-vl-max</code>、<code>gpt-4o</code>；只填文本模型时拍照会被拒绝。</p>
              </div>
              <div class="mg-item">
                <span class="tag tag-sage">隐私优先</span>
                <p>不配置密钥即为演示模式，题目只在本机规则引擎中处理。</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside class="settings-side">
        <section class="card">
          <div class="card-head"><div class="card-title">${icon('pen', 17)} 学习者</div></div>
          <div class="card-body">
            <div class="field">
              <label class="label" for="set-name">称呼</label>
              <input class="input" id="set-name" value="${escapeHtml(settings.name || '同学')}" maxlength="20" />
            </div>
            <button class="btn btn-line btn-sm btn-block mt-16" id="save-name">保存称呼</button>
          </div>
        </section>

        <section class="card">
          <div class="card-head"><div class="card-title">${icon('layers', 17)} 数据</div></div>
          <div class="card-body">
            <div class="data-stat">
              <strong>${count}</strong><span>道错题已收入本机</span>
            </div>
            <p class="small muted" style="margin:10px 0 14px">所有数据存于 <code>data/db.json</code>。可导出 JSON 自行备份。</p>
            <a class="btn btn-line btn-sm btn-block" href="/api/export" download="zhicuo-backup.json">${icon('download', 15)} 导出全部数据</a>
          </div>
        </section>

        <section class="card about-card">
          <div class="about-seal">知</div>
          <div>
            <div class="card-title">知错 · v1.0</div>
            <p class="small muted" style="margin-top:4px">拍照识题 · 错因诊断 · 掌握指南 · 举一反三 · 组卷打印</p>
            <p class="about-quote">“错题不是污点，是下一次得分的路标。”</p>
          </div>
        </section>
      </aside>
    </div>
  </div>`;
}

function bind(root, ctx) {
  const form = root.querySelector('#ai-form');
  const testResult = root.querySelector('#test-result');
  const keyInput = root.querySelector('#set-key');
  const clearKey = root.querySelector('#clear-key');

  root.querySelector('#toggle-key')?.addEventListener('click', () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  });

  const collect = () => ({
    ai: {
      baseUrl: root.querySelector('#set-base').value.trim(),
      model: root.querySelector('#set-model').value.trim(),
      visionModel: root.querySelector('#set-vision').value.trim(),
      ...(keyInput.value.trim() ? { apiKey: keyInput.value.trim() } : {}),
      ...(clearKey.checked ? { clearKey: true } : {}),
    },
  });

  const save = async (silent = false) => {
    const payload = collect();
    if (!payload.ai.baseUrl || !/^https?:\/\//i.test(payload.ai.baseUrl)) {
      toast('API 地址需要以 http:// 或 https:// 开头', 'error');
      return false;
    }
    if (!payload.ai.model) {
      toast('请填写文本模型名', 'error');
      return false;
    }
    try {
      const res = await api.updateSettings(payload);
      savedSettings = res.settings || res;
      if (!silent) toast('设置已保存', 'success');
      keyInput.value = '';
      clearKey.checked = false;
      await ctx.refreshShell();
      return true;
    } catch (err) {
      toast(err.message || '保存失败', 'error');
      return false;
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    save();
  });

  root.querySelector('#test-ai').addEventListener('click', async () => {
    const btn = root.querySelector('#test-ai');
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> 测试中…`;
    testResult.className = 'test-result';
    testResult.textContent = '';
    const saved = await save(true);
    if (!saved) {
      btn.disabled = false;
      btn.innerHTML = `${icon('practice', 16)} 测试连接`;
      return;
    }
    try {
      const res = await api.testAI();
      testResult.className = `test-result ${res.ok ? 'ok' : 'warn'}`;
      testResult.innerHTML = `${icon(res.ok ? 'circle-check' : 'alert', 15)} ${escapeHtml(res.message)} ${
        res.latency ? `<span class="mono">${res.latency}ms</span>` : ''
      }`;
      if (res.ok) toast('连接成功', 'success');
      else toast(res.message || '连接失败', 'info');
    } catch (err) {
      testResult.className = 'test-result warn';
      testResult.innerHTML = `${icon('alert', 15)} ${escapeHtml(err.message || '连接失败')}`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = `${icon('practice', 16)} 测试连接`;
    }
  });

  root.querySelector('#save-name').addEventListener('click', async () => {
    const name = root.querySelector('#set-name').value.trim() || '同学';
    try {
      const res = await api.updateSettings({ name });
      savedSettings = res.settings || res;
      toast('称呼已更新', 'success');
      await ctx.refreshShell();
    } catch (err) {
      toast(err.message || '保存失败', 'error');
    }
  });
}

export async function mount(root, ctx) {
  root.innerHTML = `<div class="page"><div class="card">${loadingBlock('正在读取设置…')}</div></div>`;
  try {
    const [settingsData, stats] = await Promise.all([api.settings(), api.stats().catch(() => ctx.state?.stats || null)]);
    savedSettings = settingsData.settings || settingsData;
    root.innerHTML = settingsShell(savedSettings, stats);
    bind(root, ctx);
  } catch (err) {
    root.innerHTML = `<div class="page"><div class="card"><div class="error-block">
      <span class="err-ico">${icon('alert', 24)}</span>
      <p>${escapeHtml(err.message || '设置读取失败')}</p>
      <button class="btn btn-line btn-sm" id="reload-settings">重新加载</button>
    </div></div></div>`;
    root.querySelector('#reload-settings')?.addEventListener('click', () => mount(root, ctx));
  }
}

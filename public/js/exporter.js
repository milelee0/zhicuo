// 知错 · A4 练习册 / 试卷导出（PNG / PDF，零依赖）
// 通过 Canvas 绘制页面，PDF 采用"图像页"最小结构封装，中文无需嵌入字体。

const PAGE_W = 1240;
const PAGE_H = 1754;
const MARGIN = 96;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BODY_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Hiragino Sans GB",sans-serif';
const DISPLAY_FONT = '"Songti SC","STSong","SimSun","Noto Serif CJK SC",serif';

const INK = '#1E2533';
const INK_SOFT = '#4A5163';
const INK_MUTE = '#7C7C72';
const RED = '#C94B36';
const LINE = '#D8CEBC';
const PAPER = '#FFFDF8';

function createCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = PAGE_H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  return { canvas, ctx };
}

function setFont(ctx, size, family = BODY_FONT, weight = '400') {
  ctx.font = `${weight} ${size}px ${family}`;
}

function wrapText(ctx, text, maxWidth) {
  const paragraphs = String(text || '').split(/\n/);
  const lines = [];
  paragraphs.forEach((paragraph) => {
    if (!paragraph) {
      lines.push('');
      return;
    }
    let line = '';
    for (const ch of paragraph) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
  });
  return lines.length ? lines : [''];
}

function drawParagraph(ctx, text, x, y, maxWidth, { size = 26, lineHeight = 45, color = INK, family = BODY_FONT, weight = '400' } = {}) {
  setFont(ctx, size, family, weight);
  ctx.fillStyle = color;
  const lines = wrapText(ctx, text, maxWidth);
  lines.forEach((line, i) => {
    ctx.fillText(line, x, y + i * lineHeight);
  });
  return y + lines.length * lineHeight;
}

function measureParagraph(ctx, text, maxWidth, { size = 26, lineHeight = 45, family = BODY_FONT, weight = '400' } = {}) {
  setFont(ctx, size, family, weight);
  return wrapText(ctx, text, maxWidth).length * lineHeight;
}

function hline(ctx, y, color = LINE, width = 1) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(PAGE_W - MARGIN, y);
  ctx.stroke();
}

function footer(ctx, pageNo, total, title) {
  setFont(ctx, 16, BODY_FONT, '400');
  ctx.fillStyle = INK_MUTE;
  ctx.textAlign = 'left';
  ctx.fillText(title || '知错 · AI 错题本', MARGIN, PAGE_H - 52);
  ctx.textAlign = 'center';
  ctx.fillText(`· ${pageNo} / ${total} ·`, PAGE_W / 2, PAGE_H - 52);
  ctx.textAlign = 'right';
  ctx.fillStyle = RED;
  ctx.fillText('把错题，变成得分点。', PAGE_W - MARGIN, PAGE_H - 52);
  ctx.textAlign = 'left';
}

function drawHeader(ctx, meta, pageNo, total) {
  // 朱砂短线
  ctx.fillStyle = RED;
  ctx.fillRect(MARGIN, 78, 46, 4);
  setFont(ctx, 17, BODY_FONT, '600');
  ctx.fillStyle = INK_MUTE;
  ctx.fillText('知错  /  AI PRACTICE SHEET', MARGIN, 116);

  setFont(ctx, 54, DISPLAY_FONT, '700');
  ctx.fillStyle = INK;
  ctx.fillText(meta.title || '举一反三练习册', MARGIN, 190);

  setFont(ctx, 21, BODY_FONT, '400');
  ctx.fillStyle = INK_SOFT;
  const sub = meta.subtitle || '';
  if (sub) ctx.fillText(sub, MARGIN, 232);

  setFont(ctx, 18, BODY_FONT, '400');
  ctx.fillStyle = INK_MUTE;
  ctx.fillText(`共 ${meta.questions.length} 题  ·  ${new Date().toLocaleDateString('zh-CN')}`, MARGIN, 270);
  if (meta.showInfo !== false) {
    ctx.textAlign = 'right';
    ctx.fillText('姓名 ______________    班级 ______________    得分 ______', PAGE_W - MARGIN, 270);
    ctx.textAlign = 'left';
  }
  hline(ctx, 296, INK, 1.2);
  footer(ctx, pageNo, total, meta.title);
}

function drawRunningHeader(ctx, meta, pageNo, total) {
  setFont(ctx, 17, BODY_FONT, '400');
  ctx.fillStyle = INK_MUTE;
  ctx.fillText(meta.title || '知错练习册', MARGIN, 74);
  ctx.textAlign = 'right';
  ctx.fillStyle = RED;
  ctx.fillText('ZHI CUO', PAGE_W - MARGIN, 74);
  ctx.textAlign = 'left';
  hline(ctx, 94);
  footer(ctx, pageNo, total, meta.title);
}

function newPage(meta, pageNo, total) {
  const p = createCanvas();
  if (pageNo === 1) drawHeader(p.ctx, meta, pageNo, total);
  else drawRunningHeader(p.ctx, meta, pageNo, total);
  return p;
}

function paddedNumber(n) {
  return String(n).padStart(2, '0');
}

function drawQuestion(ctx, q, num, y, contentW) {
  const textX = MARGIN + 52;
  const textW = contentW - 52;

  // 编号圆章
  ctx.beginPath();
  ctx.fillStyle = RED;
  ctx.arc(MARGIN + 18, y - 9, 19, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 19, BODY_FONT, '700');
  ctx.fillStyle = '#FFFDF8';
  ctx.textAlign = 'center';
  ctx.fillText(String(num), MARGIN + 18, y - 2);
  ctx.textAlign = 'left';

  // 学科 / 难度
  setFont(ctx, 15, BODY_FONT, '400');
  ctx.fillStyle = INK_MUTE;
  const tag = [q.subject, q.difficulty ? `难度 ${'●'.repeat(Math.min(5, Number(q.difficulty)))}${'○'.repeat(Math.max(0, 5 - Number(q.difficulty)))}` : '', ...(q.knowledgePoints || []).slice(0, 1)]
    .filter(Boolean)
    .join('   ');
  if (tag) ctx.fillText(tag, textX, y - 18);

  // 题干
  const textEnd = drawParagraph(ctx, q.text || '', textX, y + 22, textW, {
    size: 27,
    lineHeight: 47,
    color: INK,
  });

  // 答题留白
  const blank = Math.max(96, Math.min(260, 60 + measureParagraph(ctx, q.text || '', textW, { size: 27, lineHeight: 47 })));
  ctx.strokeStyle = '#E8DFD0';
  ctx.lineWidth = 1;
  for (let i = 1; i <= 3; i++) {
    const ly = textEnd + blank * (i / 4);
    ctx.beginPath();
    ctx.setLineDash([4, 7]);
    ctx.moveTo(textX, ly);
    ctx.lineTo(MARGIN + contentW, ly);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  return textEnd + blank + 34;
}

function drawAnswerBlock(ctx, q, num, y, contentW) {
  const textX = MARGIN + 52;
  const textW = contentW - 52;

  ctx.beginPath();
  ctx.strokeStyle = RED;
  ctx.lineWidth = 1.4;
  ctx.arc(MARGIN + 18, y - 9, 18, 0, Math.PI * 2);
  ctx.stroke();
  setFont(ctx, 18, BODY_FONT, '700');
  ctx.fillStyle = RED;
  ctx.textAlign = 'center';
  ctx.fillText(String(num), MARGIN + 18, y - 2);
  ctx.textAlign = 'left';

  setFont(ctx, 17, BODY_FONT, '400');
  ctx.fillStyle = INK_MUTE;
  ctx.fillText([q.subject, ...(q.knowledgePoints || []).slice(0, 2)].filter(Boolean).join('  ·  '), textX, y - 18);

  let cursor = y + 18;
  setFont(ctx, 23, BODY_FONT, '700');
  ctx.fillStyle = RED;
  ctx.fillText('答案', textX, cursor);
  cursor = drawParagraph(ctx, q.answer || '（略）', textX + 52, cursor, textW - 52, {
    size: 23,
    lineHeight: 38,
    color: RED,
    weight: '700',
  });
  cursor += 6;

  setFont(ctx, 19, BODY_FONT, '600');
  ctx.fillStyle = INK_SOFT;
  ctx.fillText('解析', textX, cursor);
  cursor = drawParagraph(ctx, q.analysis || '（暂无解析）', textX + 52, cursor, textW - 52, {
    size: 21,
    lineHeight: 35,
    color: INK_SOFT,
  });
  cursor += 4;

  if (q.errorType) {
    setFont(ctx, 18, BODY_FONT, '600');
    ctx.fillStyle = RED;
    ctx.fillText('易错提示', textX, cursor + 22);
    cursor = drawParagraph(ctx, `${q.errorType}${q.errorReason ? ' —— ' + q.errorReason : ''}`, textX + 78, cursor + 22, textW - 78, {
      size: 18,
      lineHeight: 30,
      color: INK_MUTE,
    });
  }

  const guide = Array.isArray(q.knowledgeGuide) ? q.knowledgeGuide.slice(0, 1) : [];
  if (guide.length) {
    cursor += 10;
    setFont(ctx, 18, BODY_FONT, '600');
    ctx.fillStyle = '#4E7C6A';
    ctx.fillText(`掌握要点 · ${guide[0].point || ''}`, textX, cursor);
    cursor += 28;
    const points = [guide[0].concept, ...(guide[0].keyPoints || []), ...(guide[0].pitfalls || []).map((p) => `易错：${p}`)]
      .filter(Boolean)
      .join('；');
    cursor = drawParagraph(ctx, points, textX, cursor, textW, {
      size: 18,
      lineHeight: 30,
      color: INK_SOFT,
    });
  }

  return cursor + 34;
}

function buildPages({ title, subtitle, questions, includeAnswers = true, includeGuide = true, showInfo = true }) {
  const meta = { title, subtitle, questions, showInfo };
  const page1 = newPage(meta, 1, 99);
  const pages = [page1];
  let page = page1;
  let ctx = page.ctx;
  let y = 342;

  const items = (questions || []).filter((q) => q && q.text);
  items.forEach((q, idx) => {
    const estimate =
      measureParagraph(ctx, q.text || '', CONTENT_W - 52, { size: 27, lineHeight: 47 }) +
      Math.max(96, Math.min(260, 60 + measureParagraph(ctx, q.text || '', CONTENT_W - 52, { size: 27, lineHeight: 47 }))) +
      100;
    if (y + estimate > PAGE_H - 96) {
      page = newPage(meta, pages.length + 1, 99);
      pages.push(page);
      ctx = page.ctx;
      y = 130;
    }
    y = drawQuestion(ctx, q, idx + 1, y, CONTENT_W);
  });

  if (includeAnswers) {
    // 答案页另起一页
    page = newPage(meta, pages.length + 1, 99);
    pages.push(page);
    ctx = page.ctx;
    y = 150;
    setFont(ctx, 40, DISPLAY_FONT, '700');
    ctx.fillStyle = INK;
    ctx.fillText('参考答案与解析', MARGIN, y);
    ctx.fillStyle = RED;
    ctx.fillRect(MARGIN, y + 18, 60, 4);
    y += 72;
    items.forEach((q, idx) => {
      const guideItems = includeGuide && Array.isArray(q.knowledgeGuide) ? q.knowledgeGuide.slice(0, 1) : [];
      const est =
        90 +
        measureParagraph(ctx, q.answer || '', CONTENT_W - 52, { size: 23, lineHeight: 38, weight: '700' }) +
        measureParagraph(ctx, q.analysis || '', CONTENT_W - 52, { size: 21, lineHeight: 35 }) +
        (q.errorReason ? 40 : 0) +
        (guideItems.length ? 110 : 0);
      if (y + est > PAGE_H - 110) {
        page = newPage(meta, pages.length + 1, 99);
        pages.push(page);
        ctx = page.ctx;
        y = 130;
      }
      y = drawAnswerBlock(ctx, q, idx + 1, y, CONTENT_W);
    });
  }

  const total = pages.length;
  pages.forEach((p, i) => {
    // 重绘页脚以写入真实总页数（先补回被清除的纸面底色，避免透明/黑边）
    p.ctx.clearRect(0, PAGE_H - 80, PAGE_W, 80);
    p.ctx.fillStyle = PAPER;
    p.ctx.fillRect(0, PAGE_H - 80, PAGE_W, 80);
    footer(p.ctx, i + 1, total, meta.title);
  });
  return pages;
}

function sanitizeFilename(name) {
  return (name || '知错练习册').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 60);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1] || '';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function buildPdf(pageCanvases, quality = 0.9) {
  const encoder = new TextEncoder();
  const chunks = [];
  let length = 0;
  const push = (data) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
    return length;
  };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const offsets = [0];
  const n = pageCanvases.length;
  const imageIds = pageCanvases.map((_, i) => 5 + i * 3);

  const startObj = (id) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
  };

  startObj(1);
  push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2);
  push(`<< /Type /Pages /Kids [${pageCanvases.map((_, i) => `${3 + i * 3} 0 R`).join(' ')}] /Count ${n} >>\nendobj\n`);

  pageCanvases.forEach((canvas, i) => {
    const jpeg = dataUrlToBytes(canvas.toDataURL('image/jpeg', quality));
    const pageId = 3 + i * 3;
    const contentId = 4 + i * 3;
    const imageId = imageIds[i];

    startObj(pageId);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    const content = 'q 595.28 0 0 841.89 0 0 cm /Im0 Do Q';
    startObj(contentId);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    startObj(imageId);
    push(
      `<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
    );
    push(jpeg);
    push('\nendstream\nendobj\n');
  });

  const objCount = 2 + n * 3 + 1;
  const xrefOffset = length;
  let xref = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let id = 1; id < objCount; id++) {
    xref += `${String(offsets[id] || 0).padStart(10, '0')} 00000 n \n`;
  }
  push(xref);
  push(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

/**
 * 导出练习册 / 试卷
 * @param {Object} options
 * @param {Array} options.questions 题目数组 {text,answer,analysis,subject,difficulty,knowledgePoints,errorType,errorReason,knowledgeGuide}
 * @param {'pdf'|'png'} options.format
 */
export async function exportQuestionSet({
  title = '知错 · 举一反三练习册',
  subtitle = '',
  questions = [],
  includeAnswers = true,
  includeGuide = true,
  showInfo = true,
  format = 'pdf',
  filename = '',
  quality = 0.9,
} = {}) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('没有可导出的题目');
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      /* 忽略字体等待失败 */
    }
  }

  const safeTitle = title.trim() || '知错练习册';
  const pages = buildPages({ title: safeTitle, subtitle, questions, includeAnswers, includeGuide, showInfo });
  const base = sanitizeFilename(filename || `${safeTitle}-${new Date().toISOString().slice(0, 10)}`);

  if (format === 'pdf') {
    const blob = buildPdf(
      pages.map((p) => p.canvas),
      quality
    );
    downloadBlob(blob, `${base}.pdf`);
    return { pages: pages.length, format: 'pdf' };
  }

  for (let i = 0; i < pages.length; i++) {
    const blob = await new Promise((resolve) => pages[i].canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('图片生成失败');
    downloadBlob(blob, `${base}${pages.length > 1 ? `-第${i + 1}页` : ''}.png`);
    if (i < pages.length - 1) await new Promise((resolve) => setTimeout(resolve, 260));
  }
  return { pages: pages.length, format: 'png' };
}

export function previewPageCount({ questions = [], includeAnswers = true } = {}) {
  return Math.max(2, Math.ceil(questions.length / 4) + (includeAnswers ? 1 : 0));
}

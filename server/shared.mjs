// 知错 · 共享常量（Node 服务与 Cloudflare Worker 共用，纯 JS、无 Node 依赖）

/** 带 HTTP 状态码的业务错误，路由层直接转成 { error } */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

export const ERROR_TYPE_LIST = [
  '概念不清',
  '审题失误',
  '计算失误',
  '方法不当',
  '迁移不足',
  '表达不规范',
  '其他',
];

export const MASTERY_LEVEL_LIST = ['未掌握', '薄弱', '基本掌握', '熟练'];

export const SUBJECTS = ['数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治'];
export const GRADES = ['高一', '高二', '高三'];
export const DIFFICULTIES = [1, 2, 3, 4, 5];

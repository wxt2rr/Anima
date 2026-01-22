import { Settings } from '../store/useStore';

// 核心配置：只有这里列出的字段，AI 才有权修改
export const AI_CONFIG_WHITELIST = [
  'theme',          // 主题模式 (light/dark)
  'themeColor',     // 主题色
  'language',       // 语言
  'density'         // 布局密度
] as const;

export type AIModifiableSettings = Pick<Settings, typeof AI_CONFIG_WHITELIST[number]>;

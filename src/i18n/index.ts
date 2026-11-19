import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

export type Locale = 'zh-CN' | 'en'
export const LOCALE_KEY = 'mammoth.console.locale'
export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh-CN', label: '中文' },
  { value: 'en', label: 'English' },
]

/** 首访跟随浏览器语言,持久化键与 theme store 同款形态。 */
export function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY)
    if (saved === 'zh-CN' || saved === 'en') return saved
  } catch {
    // 无痕模式等 localStorage 不可用:落到浏览器语言
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

export function setLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    // ignore
  }
  document.documentElement.lang = locale
  i18n.global.locale.value = locale
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initialLocale(),
  fallbackLocale: 'zh-CN', // en 缺失的 key 回落中文,迁移期安全
  silentTranslationWarn: true, // 引擎契约值(阶段名等)回落原文是有意设计,不告警
  messages: { 'zh-CN': zhCN, en },
})

// 初始挂载即同步 <html lang>
document.documentElement.lang = i18n.global.locale.value

export default i18n

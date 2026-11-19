import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** shadcn-vue 组件与业务侧统一的 className 合并工具。 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

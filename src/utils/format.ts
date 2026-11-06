import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.locale('zh-cn')

export function formatBytes(bytes?: number | null): string {
  if (bytes === undefined || bytes === null) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`
}

export function formatTime(ts?: string | null): string {
  return ts ? dayjs(ts).format('YYYY-MM-DD HH:mm:ss') : '—'
}

export function fromNow(ts?: string | null): string {
  return ts ? dayjs(ts).fromNow() : '—'
}

/**
 * 引擎版本展示:统一成带 v 前缀。引擎侧各构建路径已统一带 v(v1.3.0 /
 * git describe 的 v1.3.0-13-g09c1e1a),这里兜底旧引擎:v1.3.0 及更早的
 * goreleaser 发行版上报 1.3.0(剥了 v),旧默认值是 0.1.0-dev。
 * 仅数字版本号开头时补 v;已带 v 或非版本号形态(裸 commit hash)原样返回。
 */
export function formatVersion(v?: string | null): string {
  if (!v) return '—'
  return /^\d+\.\d+/.test(v) ? `v${v}` : v
}

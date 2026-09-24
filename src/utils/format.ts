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

// 温湿度历史数据处理（纯函数，无副作用）。
// 设备返回的每行是 [ts(UTC 秒), temperatureC, humidity, relays]，详见固件 API.md 的 GET /api/history。

const HOUR_MS = 3600 * 1000
const DAY_MS = 24 * HOUR_MS

// relays 位：bit0 日间加温 bit1 夜间加温 bit2 UVB bit3 备用；bit7 写入时为日间模式
export const RELAY_HEAT_MASK = 0x03

export const HISTORY_RANGES = [
  { key: '24h', label: '24 小时' },
  { key: '7d', label: '7 天' },
  { key: 'all', label: '长期' }
]

function toPoint(row) {
  return {
    t: Number(row[0]) * 1000,
    temp: Number(row[1]),
    hum: Number(row[2]),
    relays: Number(row[3]) || 0
  }
}

export function parseHistory(response) {
  return {
    intervalMs: (Number(response?.intervalSec) || 600) * 1000,
    timeSynced: Boolean(response?.timeSynced),
    recent: (response?.recent ?? []).map(toPoint),
    archive: (response?.archive ?? []).map(toPoint)
  }
}

// 长期视图：归档数据 + 最近 7 天里每个 0/6/12/18 点小时内的第一条（与固件归档规则一致）
function sampleEverySixHours(points) {
  const seen = new Set()
  const result = []
  for (const p of points) {
    const d = new Date(p.t)
    const hour = d.getHours()
    if (hour % 6 !== 0) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${hour}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(p)
  }
  return result
}

export function selectRange(history, range, nowMs = Date.now()) {
  if (range === 'all') {
    return [...history.archive, ...sampleEverySixHours(history.recent)]
  }
  if (range === '24h') {
    // 以最新一条为终点，设备时间未同步或刚断电重启时也能看到最后 24 小时
    const last = history.recent.at(-1)?.t ?? nowMs
    return history.recent.filter((p) => p.t > last - DAY_MS)
  }
  return history.recent
}

// 区间之间缺口超过这个时长就断开折线（设备断电/未同步期间不连线）
export function maxGapFor(range, intervalMs) {
  return range === 'all' ? 7 * HOUR_MS : intervalMs * 2.5
}

export function splitSegments(points, maxGapMs) {
  const segments = []
  let current = []
  for (const p of points) {
    const prev = current.at(-1)
    if (prev && p.t - prev.t > maxGapMs) {
      segments.push(current)
      current = []
    }
    current.push(p)
  }
  if (current.length) segments.push(current)
  return segments
}

// 加温继电器开过的时间段：每条记录代表它之前的一个区间
export function heatSpans(points, intervalMs) {
  const spans = []
  for (const p of points) {
    if (!(p.relays & RELAY_HEAT_MASK)) continue
    const start = p.t - intervalMs
    const last = spans.at(-1)
    if (last && start <= last.end) {
      last.end = p.t
    } else {
      spans.push({ start, end: p.t })
    }
  }
  return spans
}

export function summarize(points, key) {
  if (!points.length) return null
  let min = points[0]
  let max = points[0]
  let sum = 0
  for (const p of points) {
    if (p[key] < min[key]) min = p
    if (p[key] > max[key]) max = p
    sum += p[key]
  }
  return { min, max, avg: sum / points.length }
}

// 二分查找离时间 t 最近的点
export function nearestPoint(points, t) {
  if (!points.length) return null
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (points[mid].t < t) lo = mid + 1
    else hi = mid
  }
  const prev = points[lo - 1]
  return prev && t - prev.t < points[lo].t - t ? prev : points[lo]
}

function pad(n) {
  return String(n).padStart(2, '0')
}

export function formatDateTime(t) {
  const d = new Date(t)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatAxisTime(t, stepMs) {
  const d = new Date(t)
  if (stepMs < DAY_MS) return `${pad(d.getHours())}:00`
  return `${d.getMonth() + 1}/${d.getDate()}`
}

// 时间轴刻度：按跨度选步长，并对齐到本地整点/零点
export function timeTicks(startMs, endMs) {
  const span = endMs - startMs
  let stepMs
  if (span <= 36 * HOUR_MS) stepMs = 6 * HOUR_MS
  else if (span <= 10 * DAY_MS) stepMs = DAY_MS
  else if (span <= 70 * DAY_MS) stepMs = 7 * DAY_MS
  else stepMs = 30 * DAY_MS

  const first = new Date(startMs)
  first.setMinutes(0, 0, 0)
  if (stepMs >= DAY_MS) first.setHours(0)
  else first.setHours(Math.ceil(first.getHours() / 6) * 6)
  const ticks = []
  for (let t = first.getTime(); t <= endMs; t += stepMs) {
    if (t >= startMs) ticks.push(t)
  }
  return { ticks, stepMs }
}

// 数值轴刻度：取 1/2/5 × 10^n 的整齐步长
export function valueTicks(min, max, count = 4) {
  if (min === max) {
    min -= 1
    max += 1
  }
  const raw = (max - min) / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(6)))
  return { lo, hi, ticks }
}

export function toCsv(points) {
  const lines = ['time,temperatureC,humidity,dayHeat,nightHeat,uvb,relay4,dayMode']
  for (const p of points) {
    const d = new Date(p.t)
    const time = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    const bits = [0, 1, 2, 3, 7].map((b) => (p.relays >> b) & 1)
    lines.push([time, p.temp.toFixed(2), p.hum.toFixed(2), ...bits].join(','))
  }
  return lines.join('\n')
}

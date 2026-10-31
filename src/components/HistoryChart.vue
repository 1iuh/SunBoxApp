<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  formatAxisTime,
  formatDateTime,
  heatSpans,
  nearestPoint,
  splitSegments,
  timeTicks,
  valueTicks
} from '../lib/history'

const props = defineProps({
  points: { type: Array, required: true },
  metric: { type: String, default: 'temp' },
  intervalMs: { type: Number, default: 600000 },
  maxGapMs: { type: Number, default: 1500000 },
  showHeat: { type: Boolean, default: true }
})

const HEIGHT = 180
const PAD = { left: 36, right: 10, top: 20, bottom: 24 }

const root = ref(null)
const width = ref(340)
const hover = ref(null)
let resizeObserver = null

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    width.value = Math.max(240, Math.round(entry.contentRect.width))
  })
  resizeObserver.observe(root.value)
})

onUnmounted(() => resizeObserver?.disconnect())

const unit = computed(() => (props.metric === 'temp' ? '°C' : '%'))

const geometry = computed(() => {
  const pts = props.points
  if (!pts.length) return null
  const key = props.metric
  const startMs = pts[0].t
  const endMs = Math.max(pts.at(-1).t, startMs + 3600 * 1000)
  let min = Infinity
  let max = -Infinity
  for (const p of pts) {
    min = Math.min(min, p[key])
    max = Math.max(max, p[key])
  }
  const { lo, hi, ticks } = valueTicks(min, max)
  const plotW = width.value - PAD.left - PAD.right
  const plotH = HEIGHT - PAD.top - PAD.bottom
  const x = (t) => PAD.left + ((t - startMs) / (endMs - startMs)) * plotW
  const y = (v) => PAD.top + (1 - (v - lo) / (hi - lo)) * plotH
  return { key, startMs, endMs, ticks, x, y, plotW, plotH }
})

const paths = computed(() => {
  const g = geometry.value
  if (!g) return []
  return splitSegments(props.points, props.maxGapMs).map((seg) =>
    seg.map((p, i) => `${i ? 'L' : 'M'}${g.x(p.t).toFixed(1)},${g.y(p[g.key]).toFixed(1)}`).join('')
  )
})

const heatRects = computed(() => {
  const g = geometry.value
  if (!g || !props.showHeat) return []
  return heatSpans(props.points, props.intervalMs).map((s) => {
    const x1 = Math.max(PAD.left, g.x(s.start))
    const x2 = Math.min(PAD.left + g.plotW, g.x(s.end))
    return { x: x1, w: Math.max(1, x2 - x1) }
  })
})

const xTicks = computed(() => {
  const g = geometry.value
  if (!g) return []
  const { ticks, stepMs } = timeTicks(g.startMs, g.endMs)
  return ticks.map((t) => ({ x: g.x(t), label: formatAxisTime(t, stepMs) }))
})

const yTicks = computed(() => {
  const g = geometry.value
  if (!g) return []
  return g.ticks.map((v) => ({ y: g.y(v), label: Number.isInteger(v) ? v : v.toFixed(1) }))
})

const hoverMarker = computed(() => {
  const g = geometry.value
  const p = hover.value
  if (!g || !p) return null
  return { x: g.x(p.t), y: g.y(p[g.key]) }
})

function onPointer(event) {
  const g = geometry.value
  if (!g) return
  const rect = root.value.getBoundingClientRect()
  const px = event.clientX - rect.left
  const t = g.startMs + ((px - PAD.left) / g.plotW) * (g.endMs - g.startMs)
  hover.value = nearestPoint(props.points, t)
}

function clearHover() {
  hover.value = null
}
</script>

<template>
  <div ref="root" class="history-chart">
    <div class="history-readout">
      <template v-if="hover">
        <span>{{ formatDateTime(hover.t) }}</span>
        <strong>{{ hover.temp.toFixed(1) }}°C · {{ hover.hum.toFixed(0) }}%</strong>
        <span v-if="hover.relays & 0x03" class="history-heat-tag">加温</span>
      </template>
      <span v-else class="history-readout-hint">按住或移动到图上查看数值</span>
    </div>
    <svg
      v-if="geometry"
      :width="width"
      :height="HEIGHT"
      :viewBox="`0 0 ${width} ${HEIGHT}`"
      class="history-svg"
      @pointermove="onPointer"
      @pointerdown="onPointer"
      @pointerleave="clearHover"
    >
      <rect
        v-for="(r, i) in heatRects"
        :key="`heat-${i}`"
        :x="r.x"
        :y="PAD.top"
        :width="r.w"
        :height="HEIGHT - PAD.top - PAD.bottom"
        class="history-heat"
      />
      <g v-for="tick in yTicks" :key="`y-${tick.label}`">
        <line :x1="PAD.left" :x2="width - PAD.right" :y1="tick.y" :y2="tick.y" class="history-grid" />
        <text :x="PAD.left - 6" :y="tick.y + 4" text-anchor="end" class="history-axis">{{ tick.label }}</text>
      </g>
      <text :x="PAD.left - 6" :y="8" text-anchor="end" class="history-axis">{{ unit }}</text>
      <text
        v-for="tick in xTicks"
        :key="`x-${tick.x}`"
        :x="tick.x"
        :y="HEIGHT - 6"
        text-anchor="middle"
        class="history-axis"
      >
        {{ tick.label }}
      </text>
      <path
        v-for="(d, i) in paths"
        :key="`line-${i}`"
        :d="d"
        class="history-line"
        :class="metric"
      />
      <g v-if="hoverMarker">
        <line
          :x1="hoverMarker.x"
          :x2="hoverMarker.x"
          :y1="PAD.top"
          :y2="HEIGHT - PAD.bottom"
          class="history-cursor"
        />
        <circle :cx="hoverMarker.x" :cy="hoverMarker.y" r="4" class="history-dot" :class="metric" />
      </g>
    </svg>
  </div>
</template>

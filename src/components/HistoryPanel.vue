<script setup>
import { computed, onMounted, ref } from 'vue'
import HistoryChart from './HistoryChart.vue'
import { fetchDeviceHistory } from '../lib/esp32'
import {
  HISTORY_RANGES,
  formatDateTime,
  maxGapFor,
  parseHistory,
  selectRange,
  summarize,
  toCsv
} from '../lib/history'

const metricOptions = [
  { key: 'temp', label: '温度' },
  { key: 'hum', label: '湿度' }
]

const range = ref('24h')
const metric = ref('temp')
const history = ref(null)
const loadState = ref('idle')
const errorMessage = ref('')

const points = computed(() => (history.value ? selectRange(history.value, range.value) : []))

const stats = computed(() => summarize(points.value, metric.value))

const unit = computed(() => (metric.value === 'temp' ? '°C' : '%'))

const intervalMs = computed(() => history.value?.intervalMs ?? 600000)

const emptyText = computed(() => {
  if (history.value && !history.value.timeSynced) return '设备时间尚未同步（需要连上 WiFi），同步后每 10 分钟记录一次。'
  return '暂无记录。设备每 10 分钟记录一次，稍后再来看看。'
})

function formatValue(value) {
  return metric.value === 'temp' ? value.toFixed(1) : value.toFixed(0)
}

async function load() {
  loadState.value = 'loading'
  errorMessage.value = ''
  try {
    history.value = parseHistory(await fetchDeviceHistory('all'))
    loadState.value = 'success'
  } catch (error) {
    loadState.value = 'error'
    errorMessage.value = error.message
  }
}

function exportCsv() {
  const blob = new Blob(['﻿' + toCsv(points.value)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `sunbox-history-${range.value}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(load)
</script>

<template>
  <div class="screen">
    <div class="page-header">
      <h2>历史记录</h2>
      <span class="autosave-badge" :class="loadState">
        {{ loadState === 'loading' ? '读取中...' : loadState === 'error' ? '读取失败' : `${points.length} 条` }}
      </span>
    </div>

    <div class="segmented segmented-full">
      <button
        v-for="option in HISTORY_RANGES"
        :key="`range-${option.key}`"
        type="button"
        :class="{ active: range === option.key }"
        @click="range = option.key"
      >
        {{ option.label }}
      </button>
    </div>

    <div class="card history-card">
      <div class="history-toolbar">
        <div class="segmented">
          <button
            v-for="option in metricOptions"
            :key="`metric-${option.key}`"
            type="button"
            :class="{ active: metric === option.key }"
            @click="metric = option.key"
          >
            {{ option.label }}
          </button>
        </div>
        <span v-if="metric === 'temp' && range !== 'all'" class="history-legend">
          <i></i>加温灯开启
        </span>
      </div>

      <p v-if="loadState === 'error'" class="history-empty">读取失败：{{ errorMessage }}</p>
      <p v-else-if="loadState === 'loading' && !history" class="history-empty">正在读取设备记录...</p>
      <p v-else-if="!points.length" class="history-empty">{{ emptyText }}</p>
      <HistoryChart
        v-else
        :points="points"
        :metric="metric"
        :interval-ms="intervalMs"
        :max-gap-ms="maxGapFor(range, intervalMs)"
        :show-heat="metric === 'temp' && range !== 'all'"
      />
    </div>

    <div v-if="stats" class="card indicator-row history-stats">
      <div class="indicator">
        <span>最低</span>
        <strong>{{ formatValue(stats.min[metric]) }}{{ unit }}</strong>
        <small>{{ formatDateTime(stats.min.t) }}</small>
      </div>
      <div class="indicator">
        <span>平均</span>
        <strong>{{ formatValue(stats.avg) }}{{ unit }}</strong>
        <small>{{ points.length }} 个点</small>
      </div>
      <div class="indicator">
        <span>最高</span>
        <strong>{{ formatValue(stats.max[metric]) }}{{ unit }}</strong>
        <small>{{ formatDateTime(stats.max.t) }}</small>
      </div>
    </div>

    <p class="hint">
      每条记录是 10 分钟内的平均值。最近 7 天保留全部记录；更早的每天只保留 0/6/12/18 点四条，保存 2 年。
    </p>

    <div class="action-row">
      <button type="button" class="ghost-button" :disabled="loadState === 'loading'" @click="load">刷新</button>
      <button type="button" class="ghost-button" :disabled="!points.length" @click="exportCsv">导出 CSV</button>
    </div>
  </div>
</template>

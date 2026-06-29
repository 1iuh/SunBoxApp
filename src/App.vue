<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  fetchDeviceConfig,
  fetchMockDeviceConfig,
  fetchMockDeviceStatus,
  fetchDeviceStatus,
  getMockMode,
  getEsp32BaseUrl,
  resetMockDeviceConfig,
  resetDeviceConfig,
  saveMockDeviceConfig,
  saveDeviceConfig,
  setMockMode,
  setEsp32BaseUrl
} from './lib/esp32'

const tabs = [
  { key: 'home', label: '首页', icon: '◌' },
  { key: 'day', label: '日间', icon: '☀' },
  { key: 'night', label: '夜间', icon: '☾' },
  { key: 'settings', label: '系统', icon: '⚙' }
]

const activeTab = ref('home')
const baseUrl = ref(getEsp32BaseUrl())
const mockMode = ref(getMockMode())
const syncState = ref('idle')
const syncMessage = ref('当前显示的是本地演示数据，配置好设备地址后可直接同步 ESP32。')
const busyAction = ref('')
const daySaveState = ref('idle')
const nightSaveState = ref('idle')
let daySaveTimer = null
let nightSaveTimer = null
let lastSavedDayConfig = ''
let lastSavedNightConfig = ''
let syncTimer = null

const device = reactive({
  currentTemp: 32.5,
  humidity: 61,
  mode: '鏃ラ棿妯″紡',
  status: '鐘舵€侊細绛夊緟鍚屾',
  wifiConnected: false,
  timeSynced: false,
  sensorReady: false,
  relays: {
    dayHeat: false,
    nightHeat: false,
    uvb: false
  },
  relayModes: {
    dayHeat: 'heat',
    uvb: 'on',
    nightHeat: 'off'
  },
  relayPorts: {
    dayHeat: 'IO3',
    uvb: 'IO7',
    nightHeat: 'IO4'
  },
  config: {
    dayStart: '08:00',
    nightStart: '20:00',
    dayMinTemp: 30,
    dayMaxTemp: 32,
    nightMinTemp: 26,
    nightMaxTemp: 28
  }
})

const relayModeOptions = [
  { value: 'on', label: '常亮' },
  { value: 'off', label: '常闭' },
  { value: 'heat', label: '加温时启用' }
]

const relayPortOptions = ['IO3', 'IO4', 'IO7', 'IO8']

const humidityProgress = computed(() => {
  const value = Number.isFinite(device.humidity) ? device.humidity : 0
  return Math.min(100, Math.max(0, value))
})

function getTempGaugeGeometry() {
  const gaugeArcDeg = 280
  const dayMin = Number(device.config.dayMinTemp)
  const dayMax = Number(device.config.dayMaxTemp)
  const lowBound = dayMin - 5
  const highBound = dayMax + 5
  const totalRange = Math.max(1, highBound - lowBound)
  const lowDeg = (5 / totalRange) * gaugeArcDeg
  const midDeg = ((dayMax - dayMin) / totalRange) * gaugeArcDeg
  const highDeg = gaugeArcDeg - lowDeg - midDeg

  // CSS conic-gradient uses 0deg at the top.
  const gaugeStartDeg = 360 - lowDeg - midDeg / 2
  // Our polar label/needle positioning uses 0deg at the right.
  const polarStartDeg = 270 - lowDeg - midDeg / 2

  return {
    gaugeArcDeg,
    gaugeStartDeg,
    polarStartDeg,
    dayMin,
    dayMax,
    lowBound,
    highBound,
    totalRange,
    lowDeg,
    midDeg,
    highDeg
  }
}

const gaugeArcStyle = computed(() => {
  const {
    gaugeArcDeg,
    gaugeStartDeg,
    polarStartDeg,
    lowBound,
    highBound,
    totalRange,
    lowDeg,
    midDeg,
    highDeg
  } = getTempGaugeGeometry()
  const safeTemp = Math.min(highBound, Math.max(lowBound, Number(device.currentTemp)))
  const tempCurrentDeg = ((safeTemp - lowBound) / totalRange) * gaugeArcDeg
  const humidityCurrentDeg = (humidityProgress.value / 100) * gaugeArcDeg

  return {
    '--gauge-start-angle': `${gaugeStartDeg}deg`,
    '--gauge-arc-deg': `${gaugeArcDeg}deg`,
    '--temp-low-deg': `${lowDeg}deg`,
    '--temp-mid-end-deg': `${lowDeg + midDeg}deg`,
    '--temp-arc-end-deg': `${lowDeg + midDeg + highDeg}deg`,
    '--temp-needle-angle': `${gaugeStartDeg + tempCurrentDeg}deg`,
    '--humidity-progress-deg': `${humidityCurrentDeg}deg`,
    '--humidity-needle-angle': `${gaugeStartDeg + humidityCurrentDeg}deg`
  }
})

const dayModeLabel = computed(() => {
  return device.mode === 'night' ? '澶滈棿妯″紡 (Night Mode)' : '鏃ラ棿妯″紡 (Day Mode)'
})

const deviceIndicators = computed(() => [
  { label: 'Wi-Fi', value: device.wifiConnected ? '已连接' : '未连接' },
  { label: '时钟', value: device.timeSynced ? '已同步' : '未同步' },
  { label: '传感器', value: device.sensorReady ? '正常' : '异常' }
])

const topSyncLabel = computed(() => {
  if (syncState.value === 'loading') {
    return '同步中...'
  }
  if (syncState.value === 'error') {
    return '同步失败'
  }
  if (mockMode.value) {
    return 'Mock 模式'
  }
  if (syncState.value === 'success') {
    return '已连接'
  }
  return '待同步'
})

const daySaveLabel = computed(() => {
  if (daySaveState.value === 'saving') {
    return '保存中...'
  }
  if (daySaveState.value === 'success') {
    return '已保存'
  }
  if (daySaveState.value === 'error') {
    return '保存失败'
  }
  return '自动保存'
})

const nightSaveLabel = computed(() => {
  if (nightSaveState.value === 'saving') {
    return '保存中...'
  }
  if (nightSaveState.value === 'success') {
    return '已保存'
  }
  if (nightSaveState.value === 'error') {
    return '保存失败'
  }
  return '自动保存'
})

const dayRangeStyle = computed(() => {
  const minLimit = 18
  const maxLimit = 40
  const start = ((device.config.dayMinTemp - minLimit) / (maxLimit - minLimit)) * 100
  const end = ((device.config.dayMaxTemp - minLimit) / (maxLimit - minLimit)) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

const nightRangeStyle = computed(() => {
  const minLimit = 15
  const maxLimit = 32
  const start = ((device.config.nightMinTemp - minLimit) / (maxLimit - minLimit)) * 100
  const end = ((device.config.nightMaxTemp - minLimit) / (maxLimit - minLimit)) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

const scheduleRangeStyle = computed(() => {
  const start = (parseHour(device.config.dayStart) / 23) * 100
  const end = (parseHour(device.config.nightStart) / 23) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

const nightScheduleRangeStyle = computed(() => {
  const start = (parseHour(device.config.dayStart) / 23) * 100
  const end = (parseHour(device.config.nightStart) / 23) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

function formatTempMark(value) {
  return Number.isInteger(value) ? `${value}掳C` : `${value.toFixed(1)}掳C`
}

function polarLabelStyle(angleDeg, radius) {
  const radians = (angleDeg * Math.PI) / 180
  const x = Math.cos(radians) * radius
  const y = Math.sin(radians) * radius
  return {
    left: `calc(50% + ${x.toFixed(1)}px)`,
    top: `calc(50% + ${y.toFixed(1)}px)`,
    transform: 'translate(-50%, -50%)'
  }
}

function polarTempLabelStyle(angleDeg, radius) {
  const radians = (angleDeg * Math.PI) / 180
  const x = Math.cos(radians) * radius
  const y = Math.sin(radians) * radius
  const horizontal = Math.cos(radians)
  const vertical = Math.sin(radians)

  let translateX = '-50%'
  if (horizontal > 0.25) {
    translateX = '0%'
  } else if (horizontal < -0.25) {
    translateX = '-100%'
  }

  let translateY = '-50%'
  if (vertical > 0.45) {
    translateY = '-10%'
  } else if (vertical < -0.45) {
    translateY = '-90%'
  }

  return {
    left: `calc(50% + ${x.toFixed(1)}px)`,
    top: `calc(50% + ${y.toFixed(1)}px)`,
    transform: `translate(${translateX}, ${translateY})`
  }
}

const tempGaugeMarks = computed(() => {
  const { polarStartDeg, gaugeArcDeg, dayMin, dayMax, lowBound, highBound, totalRange } = getTempGaugeGeometry()

  const values = [
    { id: 'low', value: lowBound },
    { id: 'min', value: dayMin },
    { id: 'max', value: dayMax },
    { id: 'high', value: highBound }
  ]

  return values.map(({ id, value }) => {
    const progress = ((value - lowBound) / totalRange) * gaugeArcDeg
    return {
      id,
      valueLabel: formatTempMark(value),
      style: polarTempLabelStyle(polarStartDeg + progress, 105)
    }
  })
})

const humidityGaugeMarks = computed(() => {
  const { polarStartDeg, gaugeArcDeg } = getTempGaugeGeometry()
  return [
    { id: 'dry', valueLabel: '30%', style: polarLabelStyle(polarStartDeg + gaugeArcDeg * 0.15, 88) },
    { id: 'ideal', valueLabel: '60%', style: polarLabelStyle(polarStartDeg + gaugeArcDeg * 0.5, 82) },
    { id: 'wet', valueLabel: '80%', style: polarLabelStyle(polarStartDeg + gaugeArcDeg * 0.85, 88) }
  ]
})

function modeStatusText() {
  if (!device.sensorReady) {
    return '状态：传感器未就绪'
  }

  if (device.mode === 'night') {
    return device.relays.nightHeat ? '状态：夜间加温中' : '状态：夜间待机'
  }

  if (device.relays.dayHeat) {
    return '状态：日间加温中'
  }

  if (device.relays.uvb) {
    return '状态：UVB 运行中'
  }

  return '状态：运行正常'
}

function parseHour(value) {
  const [hourText = '0'] = String(value).split(':')
  const hour = Number.parseInt(hourText, 10)
  return Number.isFinite(hour) ? hour : 0
}

function hourToTime(hour) {
  const normalized = ((Number(hour) % 24) + 24) % 24
  return `${String(normalized).padStart(2, '0')}:00`
}

function formatHourLabel(value) {
  const hour = parseHour(value)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const hour12 = hour % 12 || 12
  return `${hour12}:00 ${suffix}`
}

function calculateWindowHours(startValue, endValue) {
  const startHour = parseHour(startValue)
  const endHour = parseHour(endValue)
  const duration = (endHour - startHour + 24) % 24
  return duration === 0 ? 24 : duration
}

function updateDayMinTemp(value) {
  const nextValue = Number(value)
  device.config.dayMinTemp = Math.min(nextValue, device.config.dayMaxTemp)
}

function updateDayMaxTemp(value) {
  const nextValue = Number(value)
  device.config.dayMaxTemp = Math.max(nextValue, device.config.dayMinTemp)
}

function updateNightMinTemp(value) {
  const nextValue = Number(value)
  device.config.nightMinTemp = Math.min(nextValue, device.config.nightMaxTemp)
}

function updateNightMaxTemp(value) {
  const nextValue = Number(value)
  device.config.nightMaxTemp = Math.max(nextValue, device.config.nightMinTemp)
}

function applyStatus(status) {
  device.currentTemp = status.temperatureC ?? 0
  device.humidity = status.humidity ?? 0
  device.mode = status.mode ?? 'day'
  device.wifiConnected = Boolean(status.wifiConnected)
  device.timeSynced = Boolean(status.timeSynced)
  device.sensorReady = Boolean(status.sensorReady)
  device.relays.dayHeat = Boolean(status.relays?.dayHeat)
  device.relays.nightHeat = Boolean(status.relays?.nightHeat)
  device.relays.uvb = Boolean(status.relays?.uvb)

  if (status.config) {
    applyConfig(status.config)
  }

  device.status = modeStatusText()
}

function applyConfig(config) {
  device.config.dayStart = config.dayStart ?? device.config.dayStart
  device.config.nightStart = config.nightStart ?? device.config.nightStart
  device.config.dayMinTemp = Number(config.dayMinTemp ?? device.config.dayMinTemp)
  device.config.dayMaxTemp = Number(config.dayMaxTemp ?? device.config.dayMaxTemp)
  device.config.nightMinTemp = Number(config.nightMinTemp ?? device.config.nightMinTemp)
  device.config.nightMaxTemp = Number(config.nightMaxTemp ?? device.config.nightMaxTemp)
  lastSavedDayConfig = JSON.stringify([
    device.config.dayStart,
    device.config.dayMinTemp,
    device.config.dayMaxTemp
  ])
  lastSavedNightConfig = JSON.stringify([
    device.config.nightStart,
    device.config.nightMinTemp,
    device.config.nightMaxTemp
  ])
}

function buildConfigPayload() {
  return {
    dayStart: device.config.dayStart,
    nightStart: device.config.nightStart,
    dayMinTemp: Number(device.config.dayMinTemp),
    dayMaxTemp: Number(device.config.dayMaxTemp),
    nightMinTemp: Number(device.config.nightMinTemp),
    nightMaxTemp: Number(device.config.nightMaxTemp)
  }
}

function saveBaseUrl() {
  setEsp32BaseUrl(baseUrl.value)
  syncState.value = 'idle'
  syncMessage.value = `已保存设备地址：${baseUrl.value}`
}

function updateMockMode() {
  setMockMode(mockMode.value)
  syncState.value = 'idle'
  syncMessage.value = mockMode.value
    ? '已切换到 Mock 模式，现在可以直接查看 UI 和交互。'
    : '已切换到真实设备模式，可以尝试同步 ESP32。'
  syncFromEsp32()
}

async function syncFromEsp32() {
  busyAction.value = 'sync'
  syncState.value = 'loading'
  syncMessage.value = mockMode.value
    ? '正在读取 Mock 数据...'
    : '正在读取 ESP32 状态和配置...'

  try {
    const [status, config] = await Promise.all([
      mockMode.value ? fetchMockDeviceStatus() : fetchDeviceStatus(baseUrl.value),
      mockMode.value ? fetchMockDeviceConfig() : fetchDeviceConfig(baseUrl.value)
    ])

    applyStatus(status)
    applyConfig(config)
    device.status = modeStatusText()
    syncState.value = 'success'
    syncMessage.value = mockMode.value
      ? 'Mock 同步成功，当前界面显示的是演示数据。'
      : '同步成功，当前界面已经连接到真实设备。'
  } catch (error) {
    syncState.value = 'error'
    syncMessage.value = `同步失败：${error.message}`
  } finally {
    busyAction.value = ''
  }
}

async function submitConfig() {
  busyAction.value = 'save'
  syncState.value = 'loading'
  syncMessage.value = mockMode.value
    ? '正在保存 Mock 配置...'
    : '正在保存配置到 ESP32...'

  try {
    const result = mockMode.value
      ? await saveMockDeviceConfig(buildConfigPayload())
      : await saveDeviceConfig(buildConfigPayload(), baseUrl.value)
    if (result?.config) {
      applyConfig(result.config)
    }
    syncState.value = 'success'
    syncMessage.value = mockMode.value ? 'Mock 配置已保存。' : '配置已保存到设备。'
    await syncFromEsp32()
  } catch (error) {
    syncState.value = 'error'
    syncMessage.value = `保存失败：${error.message}`
  } finally {
    if (busyAction.value === 'save') {
      busyAction.value = ''
    }
  }
}

async function restoreDefaults() {
  busyAction.value = 'reset'
  syncState.value = 'loading'
  syncMessage.value = mockMode.value
    ? '正在恢复 Mock 默认配置...'
    : '正在恢复 ESP32 默认配置...'

  try {
    if (mockMode.value) {
      await resetMockDeviceConfig()
    } else {
      await resetDeviceConfig(baseUrl.value)
    }
    syncState.value = 'success'
    syncMessage.value = mockMode.value ? 'Mock 默认配置已恢复。' : '默认配置已恢复。'
    await syncFromEsp32()
  } catch (error) {
    syncState.value = 'error'
    syncMessage.value = `恢复默认失败：${error.message}`
  } finally {
    if (busyAction.value === 'reset') {
      busyAction.value = ''
    }
  }
}

async function autoSaveDayConfig() {
  daySaveState.value = 'saving'

  try {
    const result = mockMode.value
      ? await saveMockDeviceConfig(buildConfigPayload())
      : await saveDeviceConfig(buildConfigPayload(), baseUrl.value)
    if (result?.config) {
      applyConfig(result.config)
    } else {
      lastSavedDayConfig = JSON.stringify([device.config.dayMinTemp, device.config.dayMaxTemp])
    }
    daySaveState.value = 'success'
  } catch {
    daySaveState.value = 'error'
  }
}

async function autoSaveNightConfig() {
  nightSaveState.value = 'saving'

  try {
    const result = mockMode.value
      ? await saveMockDeviceConfig(buildConfigPayload())
      : await saveDeviceConfig(buildConfigPayload(), baseUrl.value)
    if (result?.config) {
      applyConfig(result.config)
    } else {
      lastSavedNightConfig = JSON.stringify([
        device.config.nightStart,
        device.config.nightMinTemp,
        device.config.nightMaxTemp
      ])
    }
    nightSaveState.value = 'success'
  } catch {
    nightSaveState.value = 'error'
  }
}

function startAutoSync() {
  if (syncTimer) {
    window.clearInterval(syncTimer)
  }
  syncFromEsp32()
  syncTimer = window.setInterval(() => {
    if (!busyAction.value) {
      syncFromEsp32()
    }
  }, 10000)
}

onMounted(() => {
  startAutoSync()
})

onUnmounted(() => {
  if (syncTimer) {
    window.clearInterval(syncTimer)
  }
  if (daySaveTimer) {
    window.clearTimeout(daySaveTimer)
  }
  if (nightSaveTimer) {
    window.clearTimeout(nightSaveTimer)
  }
})

watch(
  () => [device.config.dayStart, device.config.dayMinTemp, device.config.dayMaxTemp, activeTab.value],
  ([dayStart, dayMinTemp, dayMaxTemp, currentTab]) => {
    if (currentTab !== 'day') {
      return
    }

    const currentConfig = JSON.stringify([
      dayStart,
      Number(dayMinTemp),
      Number(dayMaxTemp)
    ])
    if (currentConfig === lastSavedDayConfig) {
      return
    }

    if (busyAction.value === 'sync' || busyAction.value === 'save' || busyAction.value === 'reset') {
      return
    }

    daySaveState.value = 'saving'

    if (daySaveTimer) {
      window.clearTimeout(daySaveTimer)
    }

    daySaveTimer = window.setTimeout(() => {
      autoSaveDayConfig()
    }, 700)
  }
)

watch(
  () => [device.config.nightStart, device.config.nightMinTemp, device.config.nightMaxTemp, activeTab.value],
  ([nightStart, nightMinTemp, nightMaxTemp, currentTab]) => {
    if (currentTab !== 'night') {
      return
    }

    const currentConfig = JSON.stringify([
      nightStart,
      Number(nightMinTemp),
      Number(nightMaxTemp)
    ])
    if (currentConfig === lastSavedNightConfig) {
      return
    }

    if (busyAction.value === 'sync' || busyAction.value === 'save' || busyAction.value === 'reset') {
      return
    }

    nightSaveState.value = 'saving'

    if (nightSaveTimer) {
      window.clearTimeout(nightSaveTimer)
    }

    nightSaveTimer = window.setTimeout(() => {
      autoSaveNightConfig()
    }, 700)
  }
)
</script>

<template>
  <div class="app-shell">
    <div class="phone-frame">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark">馃崒</div>
          <div>
            <p class="brand-overline">smart climate</p>
            <h1>Sun Box</h1>
          </div>
        </div>
        <div class="top-sync-indicator" :data-state="syncState">
          <span class="sync-dot"></span>
          <span>{{ topSyncLabel }}</span>
        </div>
      </header>

      <main class="content">
        <section v-if="activeTab === 'home'" class="screen home-screen">
          <div class="hero-card">
            <div class="hero-gradient"></div>
            <div class="gauge-wrap">
              <div class="gauge-ring" :style="gaugeArcStyle">
                <div class="gauge-arc gauge-arc-temp"></div>
                <div class="gauge-arc gauge-arc-humidity"></div>
                <div class="gauge-needle gauge-needle-temp">
                  <span class="gauge-needle-bar"></span>
                </div>
                <div class="gauge-needle gauge-needle-humidity">
                  <span class="gauge-needle-bar"></span>
                </div>
                <div
                  v-for="mark in tempGaugeMarks"
                  :key="`temp-mark-${mark.id}`"
                  class="gauge-mark gauge-mark-temp"
                  :style="mark.style"
                >
                  <strong class="gauge-mark-value">{{ mark.valueLabel }}</strong>
                </div>
                <div
                  v-for="mark in humidityGaugeMarks"
                  :key="`humidity-mark-${mark.id}`"
                  class="gauge-mark gauge-mark-humidity"
                  :style="mark.style"
                >
                  <strong class="gauge-mark-value">{{ mark.valueLabel }}</strong>
                </div>
                <div class="gauge-center">
                  <div class="gauge-value">
                    {{ device.currentTemp.toFixed(1) }}<span>掳C</span> / {{ device.humidity.toFixed(0) }}<span>%</span>
                  </div>
                  <div class="gauge-center-label">实时温湿度</div>
                </div>
              </div>
            </div>
            <div class="hero-footer">
              <p>{{ dayModeLabel }}</p>
            </div>
          </div>

          <div class="stack-card status-card status-grid-3 home-status-grid">
            <div v-for="item in deviceIndicators" :key="item.label" class="status-tile">
              <span class="eyebrow">{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>

          <div class="stack-card status-card status-grid-3 home-status-grid">
            <div class="status-tile status-switch-tile">
              <span class="eyebrow">鏃ラ棿鍔犳俯</span>
              <div class="status-switch-row">
                <strong>{{ device.relays.dayHeat ? '开启' : '关闭' }}</strong>
                <label class="toggle-switch status-switch-display" aria-label="日间加温状态">
                  <input :checked="device.relays.dayHeat" type="checkbox" disabled />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="status-tile status-switch-tile">
              <span class="eyebrow">澶滈棿鍔犳俯</span>
              <div class="status-switch-row">
                <strong>{{ device.relays.nightHeat ? '开启' : '关闭' }}</strong>
                <label class="toggle-switch status-switch-display" aria-label="夜间加温状态">
                  <input :checked="device.relays.nightHeat" type="checkbox" disabled />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
            <div class="status-tile status-switch-tile">
              <span class="eyebrow">UVB</span>
              <div class="status-switch-row">
                <strong>{{ device.relays.uvb ? '开启' : '关闭' }}</strong>
                <label class="toggle-switch status-switch-display" aria-label="UVB 状态">
                  <input :checked="device.relays.uvb" type="checkbox" disabled />
                  <span class="toggle-slider"></span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'day'" class="screen">
          <div class="panel">
            <div class="panel-header">
              <h2>鏃ラ棿璁剧疆</h2>
              <div class="panel-header-meta">
                <span class="autosave-badge" :class="daySaveState">{{ daySaveLabel }}</span>
                <span class="panel-icon">鈽€</span>
              </div>
            </div>

            <div class="slider-card">
              <div class="slider-title">
                <span>鏃堕棿绐楀彛</span>
                <span>
                  {{ formatHourLabel(device.config.dayStart) }} - {{ formatHourLabel(device.config.nightStart) }}
                  路 {{ calculateWindowHours(device.config.dayStart, device.config.nightStart) }}灏忔椂
                </span>
              </div>
              <div class="dual-range" :style="scheduleRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="parseHour(device.config.dayStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb"
                  @input="device.config.dayStart = hourToTime($event.target.value)"
                />
                <input
                  :value="parseHour(device.config.nightStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb range-thumb-readonly"
                  disabled
                />
              </div>
              <div class="range-labels">
                <span>鏃ラ棿寮€濮?{{ formatHourLabel(device.config.dayStart) }}</span>
                <span>澶滈棿寮€濮?{{ formatHourLabel(device.config.nightStart) }}</span>
              </div>
            </div>

            <div class="slider-card">
              <div class="slider-title">
                <span>娓╁害鑼冨洿</span>
                <span>{{ device.config.dayMinTemp.toFixed(1) }}掳C - {{ device.config.dayMaxTemp.toFixed(1) }}掳C</span>
              </div>
              <div class="dual-range" :style="dayRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="device.config.dayMinTemp"
                  type="range"
                  min="18"
                  max="40"
                  step="0.5"
                  class="range-thumb"
                  @input="updateDayMinTemp($event.target.value)"
                />
                <input
                  :value="device.config.dayMaxTemp"
                  type="range"
                  min="18"
                  max="40"
                  step="0.5"
                  class="range-thumb"
                  @input="updateDayMaxTemp($event.target.value)"
                />
              </div>
              <div class="range-labels">
                <span>鏈€浣?{{ device.config.dayMinTemp.toFixed(1) }}掳C</span>
                <span>鏈€楂?{{ device.config.dayMaxTemp.toFixed(1) }}掳C</span>
              </div>
            </div>

            <div class="device-mode-card">
              <div class="device-mode-header">
                <span class="toggle-icon">☀</span>
                <p>日间加温灯</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`day-${option.value}`"
                  type="button"
                  class="mode-option"
                  :class="{ active: device.relayModes.dayHeat === option.value }"
                  @click="device.relayModes.dayHeat = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="device-mode-card muted">
              <div class="device-mode-header">
                <span class="toggle-icon">◌</span>
                <p>UVB 灯</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`uvb-${option.value}`"
                  type="button"
                  class="mode-option"
                  :class="{ active: device.relayModes.uvb === option.value }"
                  @click="device.relayModes.uvb = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="device-mode-card night-accent">
              <div class="device-mode-header">
                <span class="toggle-icon">☾</span>
                <p>夜间加温灯</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`night-${option.value}`"
                  type="button"
                  class="mode-option"
                  :class="{ active: device.relayModes.nightHeat === option.value }"
                  @click="device.relayModes.nightHeat = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'night'" class="screen night-theme">
          <div class="panel dark-panel">
            <div class="panel-header">
              <h2>澶滈棿璁剧疆</h2>
              <div class="panel-header-meta">
                <span class="autosave-badge" :class="nightSaveState">{{ nightSaveLabel }}</span>
                <span class="panel-icon">☾</span>
              </div>
            </div>

            <div class="slider-card dark">
              <div class="slider-title">
                <span>鏃堕棿绐楀彛</span>
                <span>
                  {{ formatHourLabel(device.config.nightStart) }} - {{ formatHourLabel(device.config.dayStart) }}
                  路 {{ calculateWindowHours(device.config.nightStart, device.config.dayStart) }}灏忔椂
                </span>
              </div>
              <div class="dual-range dual-range-reverse" :style="nightScheduleRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="parseHour(device.config.nightStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb"
                  @input="device.config.nightStart = hourToTime($event.target.value)"
                />
                <input
                  :value="parseHour(device.config.dayStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb range-thumb-readonly"
                  disabled
                />
              </div>
              <div class="range-labels">
                <span>澶滈棿寮€濮?{{ formatHourLabel(device.config.nightStart) }}</span>
                <span>鏃ラ棿寮€濮?{{ formatHourLabel(device.config.dayStart) }}</span>
              </div>
            </div>

            <div class="slider-card dark">
              <div class="slider-title">
                <span>娓╁害鑼冨洿</span>
                <span>{{ device.config.nightMinTemp.toFixed(1) }}掳C - {{ device.config.nightMaxTemp.toFixed(1) }}掳C</span>
              </div>
              <div class="dual-range" :style="nightRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="device.config.nightMinTemp"
                  type="range"
                  min="15"
                  max="32"
                  step="0.5"
                  class="range-thumb"
                  @input="updateNightMinTemp($event.target.value)"
                />
                <input
                  :value="device.config.nightMaxTemp"
                  type="range"
                  min="15"
                  max="32"
                  step="0.5"
                  class="range-thumb"
                  @input="updateNightMaxTemp($event.target.value)"
                />
              </div>
              <div class="range-labels">
                <span>鏈€浣?{{ device.config.nightMinTemp.toFixed(1) }}掳C</span>
                <span>鏈€楂?{{ device.config.nightMaxTemp.toFixed(1) }}掳C</span>
              </div>
            </div>

            <div class="device-mode-card dark-mode-card">
              <div class="device-mode-header">
                <span class="toggle-icon">☀</span>
                <p>日间加温灯</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`night-view-day-${option.value}`"
                  type="button"
                  class="mode-option dark-option"
                  :class="{ active: device.relayModes.dayHeat === option.value }"
                  @click="device.relayModes.dayHeat = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="device-mode-card dark-mode-card muted">
              <div class="device-mode-header">
                <span class="toggle-icon">◌</span>
                <p>UVB 灯</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`night-view-uvb-${option.value}`"
                  type="button"
                  class="mode-option dark-option"
                  :class="{ active: device.relayModes.uvb === option.value }"
                  @click="device.relayModes.uvb = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>

            <div class="device-mode-card dark-mode-card night-accent">
              <div class="device-mode-header">
                <span class="toggle-icon">☾</span>
                <p>夜间加温灯</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`night-view-night-${option.value}`"
                  type="button"
                  class="mode-option dark-option"
                  :class="{ active: device.relayModes.nightHeat === option.value }"
                  @click="device.relayModes.nightHeat = option.value"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else class="screen">
          <div class="settings-page">
            <section class="settings-hero">
              <div>
                <span class="settings-overline">System</span>
                <h2>系统设置</h2>
                <p>管理设备接入、演示模式和当前连接状态。</p>
              </div>
              <div class="settings-hero-badge" :data-state="syncState">
                <span class="sync-dot"></span>
                <span>{{ topSyncLabel }}</span>
              </div>
            </section>

            <section class="settings-grid">
              <article class="settings-panel">
                <div class="settings-panel-head">
                  <div>
                    <span class="section-kicker">Device</span>
                    <h3>ESP32 鍦板潃</h3>
                  </div>
                  <span class="section-badge">{{ mockMode ? 'Mock' : 'Live' }}</span>
                </div>
                <p class="settings-panel-copy">
                  淇濆瓨璁惧鍩虹鍦板潃锛岀湡瀹炴ā寮忎笅椤甸潰浼氳嚜鍔ㄨ鍙?                  <code>/api/status</code> 涓?<code>/api/config</code>銆?                </p>
                <div class="input-row settings-input-row">
                  <input
                    id="baseUrl"
                    v-model="baseUrl"
                    type="text"
                    placeholder="http://192.168.1.88"
                  />
                  <button type="button" @click="saveBaseUrl">淇濆瓨</button>
                </div>
              </article>

              <article class="settings-panel">
                <div class="settings-panel-head">
                  <div>
                    <span class="section-kicker">Mapping</span>
                    <h3>绔彛璁剧疆</h3>
                  </div>
                  <span class="section-badge warm">IO</span>
                </div>
                <p class="settings-panel-copy">
                  涓烘棩闂村姞鐑伅銆乁VB 鐏拰澶滈棿鍔犵儹鐏寚瀹氬搴旂殑鎺у埗绔彛銆?                </p>
                <div class="port-settings-list">
                  <label class="port-setting-row">
                    <span>日间加热灯</span>
                    <select v-model="device.relayPorts.dayHeat" class="port-select">
                      <option v-for="port in relayPortOptions" :key="`day-port-${port}`" :value="port">
                        {{ port }}
                      </option>
                    </select>
                  </label>
                  <label class="port-setting-row">
                    <span>UVB 灯</span>
                    <select v-model="device.relayPorts.uvb" class="port-select">
                      <option v-for="port in relayPortOptions" :key="`uvb-port-${port}`" :value="port">
                        {{ port }}
                      </option>
                    </select>
                  </label>
                  <label class="port-setting-row">
                    <span>夜间加热灯</span>
                    <select v-model="device.relayPorts.nightHeat" class="port-select">
                      <option v-for="port in relayPortOptions" :key="`night-port-${port}`" :value="port">
                        {{ port }}
                      </option>
                    </select>
                  </label>
                </div>
              </article>

              <article class="settings-panel">
                <div class="settings-panel-head">
                  <div>
                    <span class="section-kicker">Preview</span>
                    <h3>Mock 妯″紡</h3>
                  </div>
                  <span class="section-badge soft">{{ mockMode ? 'Enabled' : 'Disabled' }}</span>
                </div>
                <p class="settings-panel-copy">
                  <template v-if="mockMode">
                    褰撳墠浣跨敤婕旂ず鏁版嵁锛岄€傚悎鍏堟鏌?UI銆佷氦浜掑拰椤甸潰鑺傚銆?                  </template>
                  <template v-else>
                    褰撳墠宸插垏鍒扮湡瀹炶澶囨ā寮忥紝椤甸潰浼氭瘡 10 绉掕嚜鍔ㄥ悓姝ヤ竴娆¤澶囩姸鎬併€?                  </template>
                </p>
                <label class="mode-toggle compact-toggle" for="mockMode">
                  <span>
                    <strong>{{ mockMode ? '已开启' : '已关闭' }}</strong>
                    <small>切换前端数据源</small>
                  </span>
                  <input id="mockMode" v-model="mockMode" type="checkbox" @change="updateMockMode" />
                </label>
              </article>
            </section>

            <section class="settings-status-card" :data-state="syncState">
                <div class="settings-panel-head">
                  <div>
                    <span class="section-kicker">Status</span>
                    <h3>连接状态</h3>
                  </div>
                <span class="section-badge" :class="syncState">
                  {{ syncState === 'success' ? 'OK' : syncState === 'error' ? 'Error' : syncState === 'loading' ? 'Syncing' : 'Idle' }}
                </span>
              </div>
              <div class="status-pill-row">
                <span class="status-pill" :class="{ active: device.wifiConnected }">Wi-Fi</span>
                <span class="status-pill" :class="{ active: device.timeSynced }">NTP</span>
                <span class="status-pill" :class="{ active: device.sensorReady }">Sensor</span>
              </div>
              <p class="settings-panel-copy">{{ syncMessage }}</p>
            </section>
          </div>
        </section>
      </main>

      <nav class="bottom-nav" aria-label="主导航">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="nav-item"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          <span class="nav-icon">{{ tab.icon }}</span>
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </div>
  </div>
</template>

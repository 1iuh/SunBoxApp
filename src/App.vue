<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  fetchDeviceStatus,
  fetchDeviceRules,
  saveDeviceRules,
  resetDeviceConfig,
  setDevicePower,
  toggleDeviceRelay,
  saveDevicePins,
  getEsp32BaseUrl,
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
const syncState = ref('idle')
const syncMessage = ref('配置好设备地址后即可同步 ESP32 状态与配置。')
const busyAction = ref('')
const daySaveState = ref('idle')
const nightSaveState = ref('idle')
let daySaveTimer = null
let nightSaveTimer = null
let lastSavedDayConfig = ''
let lastSavedNightConfig = ''
let syncTimer = null

const device = reactive({
  currentTemp: 0,
  humidity: 0,
  mode: 'day',
  status: '状态：等待同步',
  wifiConnected: false,
  timeSynced: false,
  sensorReady: false,
  powerEnabled: true,
  manualOverride: false,
  relays: {
    dayHeat: false,
    nightHeat: false,
    uvb: false,
    relay4: false
  },
  pins: {
    i2cSda: 1,
    i2cScl: 0,
    relayDayHeat: 3,
    relayNightHeat: 4,
    relayDayUvb: 5,
    relay4: 7
  },
  rules: {
    dayStart: '08:00',
    nightStart: '20:00',
    dayMinTemp: 30,
    dayMaxTemp: 32,
    dayHeatRole: 2,
    dayNightHeatRole: 0,
    dayUvbRole: 1,
    dayReservedRole: 0,
    nightMinTemp: 26,
    nightMaxTemp: 28,
    nightHeatRole: 0,
    nightNightHeatRole: 2,
    nightUvbRole: 0,
    nightReservedRole: 0
  }
})

const relayModeOptions = [
  { value: 'on', label: '常亮' },
  { value: 'off', label: '常闭' },
  { value: 'heat', label: '加温时启用' }
]

const gpioOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10]

const homeRelays = [
  { key: 'dayHeat', label: '日间加温' },
  { key: 'nightHeat', label: '夜间加温' },
  { key: 'uvb', label: 'UVB' }
]

const relayList = [
  { key: 'dayHeat', label: '日间加温灯', icon: '☀', accent: '' },
  { key: 'uvb', label: 'UVB 灯', icon: '◌', accent: 'muted' },
  { key: 'nightHeat', label: '夜间加温灯', icon: '☾', accent: 'night-accent' },
  { key: 'reserved', label: '备用继电器', icon: '◇', accent: 'muted' }
]

const pinRelayList = [
  { key: 'relayDayHeat', label: '日间加温灯' },
  { key: 'relayNightHeat', label: '夜间加温灯' },
  { key: 'relayDayUvb', label: 'UVB 灯' },
  { key: 'relay4', label: '备用继电器' }
]

const relayRoleSuffix = {
  dayHeat: 'HeatRole',
  nightHeat: 'NightHeatRole',
  uvb: 'UvbRole',
  reserved: 'ReservedRole'
}

function roleToMode(role) {
  const value = Number(role)
  if (value === 1) return 'on'
  if (value === 2) return 'heat'
  return 'off'
}

function modeToRole(mode) {
  if (mode === 'on') return 1
  if (mode === 'heat') return 2
  return 0
}

function roleKeyFor(mode, relay) {
  return `${mode}${relayRoleSuffix[relay]}`
}

function relayRoleMode(mode, relay) {
  return roleToMode(device.rules[roleKeyFor(mode, relay)])
}

function setRelayRoleMode(mode, relay, modeValue) {
  device.rules[roleKeyFor(mode, relay)] = modeToRole(modeValue)
}

function getTempGaugeGeometry() {
  const gaugeArcDeg = 280
  const dayMin = Number(device.rules.dayMinTemp)
  const dayMax = Number(device.rules.dayMaxTemp)
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

  return {
    '--gauge-start-angle': `${gaugeStartDeg}deg`,
    '--gauge-arc-deg': `${gaugeArcDeg}deg`,
    '--temp-arc-end-deg': `${lowDeg + midDeg + highDeg}deg`,
    '--temp-progress-deg': `${tempCurrentDeg}deg`,
    '--temp-needle-angle': `${gaugeStartDeg + tempCurrentDeg}deg`
  }
})

const dayModeLabel = computed(() => {
  return device.mode === 'night' ? '夜间模式 (Night Mode)' : '日间模式 (Day Mode)'
})

const deviceIndicators = computed(() => [
  { label: '湿度', value: `${device.humidity.toFixed(0)}%` },
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
  const start = ((device.rules.dayMinTemp - minLimit) / (maxLimit - minLimit)) * 100
  const end = ((device.rules.dayMaxTemp - minLimit) / (maxLimit - minLimit)) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

const nightRangeStyle = computed(() => {
  const minLimit = 15
  const maxLimit = 32
  const start = ((device.rules.nightMinTemp - minLimit) / (maxLimit - minLimit)) * 100
  const end = ((device.rules.nightMaxTemp - minLimit) / (maxLimit - minLimit)) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

const scheduleRangeStyle = computed(() => {
  const start = (parseHour(device.rules.dayStart) / 23) * 100
  const end = (parseHour(device.rules.nightStart) / 23) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

const nightScheduleRangeStyle = computed(() => {
  const start = (parseHour(device.rules.dayStart) / 23) * 100
  const end = (parseHour(device.rules.nightStart) / 23) * 100
  return {
    '--range-start': `${Math.max(0, Math.min(start, 100))}%`,
    '--range-end': `${Math.max(0, Math.min(end, 100))}%`
  }
})

function formatTempMark(value) {
  return Number.isInteger(value) ? `${value}°C` : `${value.toFixed(1)}°C`
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

function modeStatusText() {
  if (!device.powerEnabled) {
    return '状态：电源已关闭'
  }

  if (device.manualOverride) {
    return '状态：手动控制中'
  }

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
  device.rules.dayMinTemp = Math.min(nextValue, device.rules.dayMaxTemp)
}

function updateDayMaxTemp(value) {
  const nextValue = Number(value)
  device.rules.dayMaxTemp = Math.max(nextValue, device.rules.dayMinTemp)
}

function updateNightMinTemp(value) {
  const nextValue = Number(value)
  device.rules.nightMinTemp = Math.min(nextValue, device.rules.nightMaxTemp)
}

function updateNightMaxTemp(value) {
  const nextValue = Number(value)
  device.rules.nightMaxTemp = Math.max(nextValue, device.rules.nightMinTemp)
}

function applyStatus(status) {
  device.currentTemp = status.temperatureC ?? 0
  device.humidity = status.humidity ?? 0
  device.mode = status.mode ?? 'day'
  device.wifiConnected = Boolean(status.wifiConnected)
  device.timeSynced = Boolean(status.timeSynced)
  device.sensorReady = Boolean(status.sensorReady)
  device.powerEnabled = status.powerEnabled !== false
  device.manualOverride = Boolean(status.manualOverride)
  device.relays.dayHeat = Boolean(status.relays?.dayHeat)
  device.relays.nightHeat = Boolean(status.relays?.nightHeat)
  device.relays.uvb = Boolean(status.relays?.uvb)
  device.relays.relay4 = Boolean(status.relays?.relay4)

  if (status.pins) {
    applyPins(status.pins)
  }

  if (status.rules) {
    applyRules(status.rules)
  }

  device.status = modeStatusText()
}

function applyPins(pins) {
  device.pins.i2cSda = Number(pins.i2cSda ?? device.pins.i2cSda)
  device.pins.i2cScl = Number(pins.i2cScl ?? device.pins.i2cScl)
  device.pins.relayDayHeat = Number(pins.relayDayHeat ?? device.pins.relayDayHeat)
  device.pins.relayNightHeat = Number(pins.relayNightHeat ?? device.pins.relayNightHeat)
  device.pins.relayDayUvb = Number(pins.relayDayUvb ?? device.pins.relayDayUvb)
  device.pins.relay4 = Number(pins.relay4 ?? device.pins.relay4)
}

function applyRules(rules) {
  device.rules.dayStart = rules.dayStart ?? device.rules.dayStart
  device.rules.nightStart = rules.nightStart ?? device.rules.nightStart
  device.rules.dayMinTemp = Number(rules.dayMinTemp ?? device.rules.dayMinTemp)
  device.rules.dayMaxTemp = Number(rules.dayMaxTemp ?? device.rules.dayMaxTemp)
  device.rules.dayHeatRole = Number(rules.dayHeatRole ?? device.rules.dayHeatRole)
  device.rules.dayNightHeatRole = Number(rules.dayNightHeatRole ?? device.rules.dayNightHeatRole)
  device.rules.dayUvbRole = Number(rules.dayUvbRole ?? device.rules.dayUvbRole)
  device.rules.dayReservedRole = Number(rules.dayReservedRole ?? device.rules.dayReservedRole)
  device.rules.nightMinTemp = Number(rules.nightMinTemp ?? device.rules.nightMinTemp)
  device.rules.nightMaxTemp = Number(rules.nightMaxTemp ?? device.rules.nightMaxTemp)
  device.rules.nightHeatRole = Number(rules.nightHeatRole ?? device.rules.nightHeatRole)
  device.rules.nightNightHeatRole = Number(rules.nightNightHeatRole ?? device.rules.nightNightHeatRole)
  device.rules.nightUvbRole = Number(rules.nightUvbRole ?? device.rules.nightUvbRole)
  device.rules.nightReservedRole = Number(rules.nightReservedRole ?? device.rules.nightReservedRole)
  lastSavedDayConfig = JSON.stringify([
    device.rules.dayStart,
    device.rules.dayMinTemp,
    device.rules.dayMaxTemp,
    device.rules.dayHeatRole,
    device.rules.dayNightHeatRole,
    device.rules.dayUvbRole,
    device.rules.dayReservedRole
  ])
  lastSavedNightConfig = JSON.stringify([
    device.rules.nightStart,
    device.rules.nightMinTemp,
    device.rules.nightMaxTemp,
    device.rules.nightHeatRole,
    device.rules.nightNightHeatRole,
    device.rules.nightUvbRole,
    device.rules.nightReservedRole
  ])
}

function buildRulesPayload() {
  return {
    dayStart: device.rules.dayStart,
    nightStart: device.rules.nightStart,
    dayMinTemp: Number(device.rules.dayMinTemp),
    dayMaxTemp: Number(device.rules.dayMaxTemp),
    dayHeatRole: Number(device.rules.dayHeatRole),
    dayNightHeatRole: Number(device.rules.dayNightHeatRole),
    dayUvbRole: Number(device.rules.dayUvbRole),
    dayReservedRole: Number(device.rules.dayReservedRole),
    nightMinTemp: Number(device.rules.nightMinTemp),
    nightMaxTemp: Number(device.rules.nightMaxTemp),
    nightHeatRole: Number(device.rules.nightHeatRole),
    nightNightHeatRole: Number(device.rules.nightNightHeatRole),
    nightUvbRole: Number(device.rules.nightUvbRole),
    nightReservedRole: Number(device.rules.nightReservedRole)
  }
}

function buildPinsPayload() {
  return {
    relayDayHeat: Number(device.pins.relayDayHeat),
    relayNightHeat: Number(device.pins.relayNightHeat),
    relayDayUvb: Number(device.pins.relayDayUvb),
    relay4: Number(device.pins.relay4)
  }
}

function saveBaseUrl() {
  setEsp32BaseUrl(baseUrl.value)
  syncState.value = 'idle'
  syncMessage.value = `已保存设备地址：${baseUrl.value}`
  syncFromEsp32()
}

async function syncFromEsp32() {
  busyAction.value = 'sync'
  syncState.value = 'loading'
  syncMessage.value = '正在读取 ESP32 状态和配置...'

  try {
    const [status, rules] = await Promise.all([
      fetchDeviceStatus(baseUrl.value),
      fetchDeviceRules(baseUrl.value)
    ])

    applyStatus(status)
    applyRules(rules)
    device.status = modeStatusText()
    syncState.value = 'success'
    syncMessage.value = '同步成功，当前界面已经连接到真实设备。'
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
  syncMessage.value = '正在保存配置到 ESP32...'

  try {
    const result = await saveDeviceRules(buildRulesPayload(), baseUrl.value)
    if (result?.rules) {
      applyRules(result.rules)
    }
    syncState.value = 'success'
    syncMessage.value = '配置已保存到设备。'
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
  syncMessage.value = '正在恢复 ESP32 默认配置...'

  try {
    await resetDeviceConfig(baseUrl.value)
    syncState.value = 'success'
    syncMessage.value = '默认配置已恢复。'
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
    const result = await saveDeviceRules(buildRulesPayload(), baseUrl.value)
    if (result?.rules) {
      applyRules(result.rules)
    } else {
      lastSavedDayConfig = JSON.stringify([
        device.rules.dayStart,
        device.rules.dayMinTemp,
        device.rules.dayMaxTemp,
        device.rules.dayHeatRole,
        device.rules.dayNightHeatRole,
        device.rules.dayUvbRole,
        device.rules.dayReservedRole
      ])
    }
    daySaveState.value = 'success'
  } catch {
    daySaveState.value = 'error'
  }
}

async function autoSaveNightConfig() {
  nightSaveState.value = 'saving'

  try {
    const result = await saveDeviceRules(buildRulesPayload(), baseUrl.value)
    if (result?.rules) {
      applyRules(result.rules)
    } else {
      lastSavedNightConfig = JSON.stringify([
        device.rules.nightStart,
        device.rules.nightMinTemp,
        device.rules.nightMaxTemp,
        device.rules.nightHeatRole,
        device.rules.nightNightHeatRole,
        device.rules.nightUvbRole,
        device.rules.nightReservedRole
      ])
    }
    nightSaveState.value = 'success'
  } catch {
    nightSaveState.value = 'error'
  }
}

async function togglePower() {
  if (busyAction.value) {
    return
  }
  busyAction.value = 'power'
  try {
    const next = !device.powerEnabled
    await setDevicePower(next, baseUrl.value)
    device.powerEnabled = next
    device.manualOverride = false
    syncState.value = 'success'
    syncMessage.value = next ? '电源已开启。' : '电源已关闭，所有继电器已断开。'
    await syncFromEsp32()
  } catch (error) {
    syncState.value = 'error'
    syncMessage.value = `电源操作失败：${error.message}`
  } finally {
    if (busyAction.value === 'power') {
      busyAction.value = ''
    }
  }
}

async function toggleRelay(relay) {
  if (busyAction.value) {
    return
  }
  busyAction.value = 'relay'
  try {
    const next = !device.relays[relay]
    await toggleDeviceRelay(relay, next, baseUrl.value)
    device.relays[relay] = next
    device.manualOverride = true
    syncMessage.value = `${relay} 已${next ? '开启' : '关闭'}（手动控制 60 秒）。`
    await syncFromEsp32()
  } catch (error) {
    syncState.value = 'error'
    syncMessage.value = `继电器操作失败：${error.message}`
  } finally {
    if (busyAction.value === 'relay') {
      busyAction.value = ''
    }
  }
}

async function submitPins() {
  if (busyAction.value) {
    return
  }
  busyAction.value = 'pins'
  syncState.value = 'loading'
  syncMessage.value = '正在保存端口映射...'

  try {
    const result = await saveDevicePins(buildPinsPayload(), baseUrl.value)
    if (result?.pins) {
      applyPins(result.pins)
    }
    syncState.value = 'success'
    syncMessage.value = '端口映射已保存。'
  } catch (error) {
    syncState.value = 'error'
    syncMessage.value = `端口保存失败：${error.message}`
  } finally {
    if (busyAction.value === 'pins') {
      busyAction.value = ''
    }
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
  () => [
    device.rules.dayStart,
    device.rules.dayMinTemp,
    device.rules.dayMaxTemp,
    device.rules.dayHeatRole,
    device.rules.dayNightHeatRole,
    device.rules.dayUvbRole,
    device.rules.dayReservedRole,
    activeTab.value
  ],
  (values) => {
    if (values[values.length - 1] !== 'day') {
      return
    }

    const currentConfig = JSON.stringify([
      device.rules.dayStart,
      Number(device.rules.dayMinTemp),
      Number(device.rules.dayMaxTemp),
      Number(device.rules.dayHeatRole),
      Number(device.rules.dayNightHeatRole),
      Number(device.rules.dayUvbRole),
      Number(device.rules.dayReservedRole)
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
  () => [
    device.rules.nightStart,
    device.rules.nightMinTemp,
    device.rules.nightMaxTemp,
    device.rules.nightHeatRole,
    device.rules.nightNightHeatRole,
    device.rules.nightUvbRole,
    device.rules.nightReservedRole,
    activeTab.value
  ],
  (values) => {
    if (values[values.length - 1] !== 'night') {
      return
    }

    const currentConfig = JSON.stringify([
      device.rules.nightStart,
      Number(device.rules.nightMinTemp),
      Number(device.rules.nightMaxTemp),
      Number(device.rules.nightHeatRole),
      Number(device.rules.nightNightHeatRole),
      Number(device.rules.nightUvbRole),
      Number(device.rules.nightReservedRole)
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
          <div class="brand-mark">☀</div>
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
          <div class="panel home-panel">
            <div class="panel-header">
              <h2>设备概览</h2>
            </div>

            <div class="hero-card home-hero-card">
              <div class="hero-gradient"></div>
              <div class="gauge-wrap">
                <div class="gauge-ring" :style="gaugeArcStyle">
                  <div class="gauge-arc gauge-arc-track"></div>
                  <div class="gauge-arc gauge-arc-temp"></div>
                  <div class="gauge-needle gauge-needle-temp">
                    <span class="gauge-needle-bar"></span>
                  </div>
                  <div class="gauge-center">
                    <div class="gauge-center-eyebrow">实时温度</div>
                    <div class="gauge-value">
                      {{ device.currentTemp.toFixed(1) }}<span>°C</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="hero-footer">
                <p>{{ device.status }}</p>
              </div>
            </div>

            <div class="stack-card status-card status-grid-3 home-status-grid home-indicator-grid">
              <div v-for="item in deviceIndicators" :key="item.label" class="status-tile">
                <span class="eyebrow">{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            </div>

            <div class="stack-card home-power-card" :class="{ off: !device.powerEnabled }">
              <div class="home-power-info">
                <span class="eyebrow">总电源</span>
                <strong>{{ device.powerEnabled ? '运行中' : '已关闭' }}</strong>
                <small v-if="device.manualOverride">手动控制中，自动加温已暂停</small>
                <small v-else>断开后所有继电器立即锁定</small>
              </div>
              <label class="toggle-switch" aria-label="总电源">
                <input
                  :checked="device.powerEnabled"
                  type="checkbox"
                  :disabled="busyAction !== ''"
                  @change="togglePower"
                />
                <span class="toggle-slider"></span>
              </label>
            </div>

            <div class="stack-card status-card status-grid-3 home-status-grid home-switch-grid">
              <div
                v-for="relay in homeRelays"
                :key="`home-relay-${relay.key}`"
                class="status-tile status-switch-tile"
              >
                <span class="eyebrow">{{ relay.label }}</span>
                <div class="status-switch-row">
                  <label class="toggle-switch status-switch-display" :aria-label="`${relay.label} 状态`">
                    <input
                      :checked="device.relays[relay.key]"
                      type="checkbox"
                      :disabled="!device.powerEnabled || busyAction !== ''"
                      @change="toggleRelay(relay.key)"
                    />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'day'" class="screen">
          <div class="panel">
            <div class="panel-header">
              <h2>日间设置</h2>
              <div class="panel-header-meta">
                <span class="autosave-badge" :class="daySaveState">{{ daySaveLabel }}</span>
                <span class="panel-icon">☀</span>
              </div>
            </div>

            <div class="slider-card">
              <div class="slider-title">
                <span>时间窗口</span>
                <span>
                  {{ formatHourLabel(device.rules.dayStart) }} - {{ formatHourLabel(device.rules.nightStart) }}
                  · {{ calculateWindowHours(device.rules.dayStart, device.rules.nightStart) }}小时
                </span>
              </div>
              <div class="dual-range" :style="scheduleRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="parseHour(device.rules.dayStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb"
                  @input="device.rules.dayStart = hourToTime($event.target.value)"
                />
                <input
                  :value="parseHour(device.rules.nightStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb range-thumb-readonly"
                  disabled
                />
              </div>
              <div class="range-labels">
                <span>日间开始 {{ formatHourLabel(device.rules.dayStart) }}</span>
                <span>夜间开始 {{ formatHourLabel(device.rules.nightStart) }}</span>
              </div>
            </div>

            <div class="slider-card">
              <div class="slider-title">
                <span>温度范围</span>
                <span>{{ device.rules.dayMinTemp.toFixed(1) }}°C - {{ device.rules.dayMaxTemp.toFixed(1) }}°C</span>
              </div>
              <div class="dual-range" :style="dayRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="device.rules.dayMinTemp"
                  type="range"
                  min="18"
                  max="40"
                  step="0.5"
                  class="range-thumb"
                  @input="updateDayMinTemp($event.target.value)"
                />
                <input
                  :value="device.rules.dayMaxTemp"
                  type="range"
                  min="18"
                  max="40"
                  step="0.5"
                  class="range-thumb"
                  @input="updateDayMaxTemp($event.target.value)"
                />
              </div>
              <div class="range-labels">
                <span>最低 {{ device.rules.dayMinTemp.toFixed(1) }}°C</span>
                <span>最高 {{ device.rules.dayMaxTemp.toFixed(1) }}°C</span>
              </div>
            </div>

            <div
              v-for="relay in relayList"
              :key="`day-${relay.key}`"
              class="device-mode-card"
              :class="relay.accent"
            >
              <div class="device-mode-header">
                <span class="toggle-icon">{{ relay.icon }}</span>
                <p>{{ relay.label }}</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`day-${relay.key}-${option.value}`"
                  type="button"
                  class="mode-option"
                  :class="{ active: relayRoleMode('day', relay.key) === option.value }"
                  @click="setRelayRoleMode('day', relay.key, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-else-if="activeTab === 'night'" class="screen">
          <div class="panel">
            <div class="panel-header">
              <h2>夜间设置</h2>
              <div class="panel-header-meta">
                <span class="autosave-badge" :class="nightSaveState">{{ nightSaveLabel }}</span>
                <span class="panel-icon">☾</span>
              </div>
            </div>

            <div class="slider-card">
              <div class="slider-title">
                <span>时间窗口</span>
                <span>
                  {{ formatHourLabel(device.rules.nightStart) }} - {{ formatHourLabel(device.rules.dayStart) }}
                  · {{ calculateWindowHours(device.rules.nightStart, device.rules.dayStart) }}小时
                </span>
              </div>
              <div class="dual-range dual-range-reverse" :style="nightScheduleRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="parseHour(device.rules.nightStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb"
                  @input="device.rules.nightStart = hourToTime($event.target.value)"
                />
                <input
                  :value="parseHour(device.rules.dayStart)"
                  type="range"
                  min="0"
                  max="23"
                  step="1"
                  class="range-thumb range-thumb-readonly"
                  disabled
                />
              </div>
              <div class="range-labels">
                <span>夜间开始 {{ formatHourLabel(device.rules.nightStart) }}</span>
                <span>日间开始 {{ formatHourLabel(device.rules.dayStart) }}</span>
              </div>
            </div>

            <div class="slider-card">
              <div class="slider-title">
                <span>温度范围</span>
                <span>{{ device.rules.nightMinTemp.toFixed(1) }}°C - {{ device.rules.nightMaxTemp.toFixed(1) }}°C</span>
              </div>
              <div class="dual-range" :style="nightRangeStyle">
                <div class="dual-range-track"></div>
                <input
                  :value="device.rules.nightMinTemp"
                  type="range"
                  min="15"
                  max="32"
                  step="0.5"
                  class="range-thumb"
                  @input="updateNightMinTemp($event.target.value)"
                />
                <input
                  :value="device.rules.nightMaxTemp"
                  type="range"
                  min="15"
                  max="32"
                  step="0.5"
                  class="range-thumb"
                  @input="updateNightMaxTemp($event.target.value)"
                />
              </div>
              <div class="range-labels">
                <span>最低 {{ device.rules.nightMinTemp.toFixed(1) }}°C</span>
                <span>最高 {{ device.rules.nightMaxTemp.toFixed(1) }}°C</span>
              </div>
            </div>

            <div
              v-for="relay in relayList"
              :key="`night-${relay.key}`"
              class="device-mode-card"
              :class="relay.accent"
            >
              <div class="device-mode-header">
                <span class="toggle-icon">{{ relay.icon }}</span>
                <p>{{ relay.label }}</p>
              </div>
              <div class="mode-picker">
                <button
                  v-for="option in relayModeOptions"
                  :key="`night-${relay.key}-${option.value}`"
                  type="button"
                  class="mode-option"
                  :class="{ active: relayRoleMode('night', relay.key) === option.value }"
                  @click="setRelayRoleMode('night', relay.key, option.value)"
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
                <p>管理设备接入、电源控制、端口映射和当前连接状态。</p>
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
                    <h3>ESP32 地址</h3>
                  </div>
                  <span class="section-badge">Live</span>
                </div>
                <p class="settings-panel-copy">
                  保存设备基础地址，页面会自动读取 <code>/api/status</code> 和 <code>/api/rules</code>。
                </p>
                <div class="input-row settings-input-row">
                  <input
                    id="baseUrl"
                    v-model="baseUrl"
                    type="text"
                    placeholder="留空使用当前域名（同源）"
                  />
                  <button type="button" @click="saveBaseUrl">保存</button>
                </div>
              </article>

              <article class="settings-panel">
                <div class="settings-panel-head">
                  <div>
                    <span class="section-kicker">Power</span>
                    <h3>总电源</h3>
                  </div>
                  <span class="section-badge" :class="device.powerEnabled ? '' : 'soft'">
                    {{ device.powerEnabled ? 'On' : 'Off' }}
                  </span>
                </div>
                <p class="settings-panel-copy">
                  关闭后所有继电器立即断开并锁定；重新开启会恢复自动控制，并清除手动覆盖。
                </p>
                <label class="mode-toggle compact-toggle" aria-label="总电源">
                  <span>
                    <strong>{{ device.powerEnabled ? '已开启' : '已关闭' }}</strong>
                    <small v-if="device.manualOverride">手动控制中，自动加温已暂停</small>
                    <small v-else>切换设备全局电源</small>
                  </span>
                  <input
                    :checked="device.powerEnabled"
                    type="checkbox"
                    :disabled="busyAction !== ''"
                    @change="togglePower"
                  />
                </label>
              </article>

              <article class="settings-panel">
                <div class="settings-panel-head">
                  <div>
                    <span class="section-kicker">Mapping</span>
                    <h3>端口设置</h3>
                  </div>
                  <span class="section-badge warm">GPIO</span>
                </div>
                <p class="settings-panel-copy">
                  为四路继电器指定对应的 GPIO 引脚（可选 2–10，需互不相同），保存后立即生效。
                </p>
                <div class="port-settings-list">
                  <label
                    v-for="item in pinRelayList"
                    :key="`pin-${item.key}`"
                    class="port-setting-row"
                  >
                    <span>{{ item.label }}</span>
                    <select v-model="device.pins[item.key]" class="port-select">
                      <option
                        v-for="gpio in gpioOptions"
                        :key="`pin-${item.key}-${gpio}`"
                        :value="gpio"
                      >
                        IO{{ gpio }}
                      </option>
                    </select>
                  </label>
                </div>
                <div class="action-row">
                  <button
                    type="button"
                    class="primary-button"
                    :disabled="busyAction !== ''"
                    @click="submitPins"
                  >
                    保存端口映射
                  </button>
                  <button
                    type="button"
                    class="ghost-button"
                    :disabled="busyAction !== ''"
                    @click="restoreDefaults"
                  >
                    恢复默认规则
                  </button>
                </div>
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
                <span class="status-pill" :class="{ active: device.powerEnabled }">电源</span>
                <span class="status-pill" :class="{ active: device.wifiConnected }">Wi-Fi</span>
                <span class="status-pill" :class="{ active: device.timeSynced }">NTP</span>
                <span class="status-pill" :class="{ active: device.sensorReady }">Sensor</span>
                <span class="status-pill" :class="{ active: device.manualOverride }">手动</span>
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

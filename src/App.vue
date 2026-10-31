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
  clearDeviceHistory
} from './lib/esp32'
import HistoryPanel from './components/HistoryPanel.vue'

const tabs = [
  { key: 'home', label: '首页', icon: '◌' },
  { key: 'day', label: '日间', icon: '☀' },
  { key: 'night', label: '夜间', icon: '☾' },
  { key: 'history', label: '记录', icon: '∿' },
  { key: 'settings', label: '系统', icon: '⚙' }
]

const activeTab = ref('home')
// 请求出错（或按钮操作完成）时在底部弹出的短提示
const toast = ref(null)
let toastTimer = null
// 页面不定时轮询；以下两个时机自动回读一次，避免显示过时的状态
let lastSyncAt = 0
let overrideRefreshTimer = null
const MANUAL_OVERRIDE_MS = 60000
const STALE_AFTER_MS = 30000
const busyAction = ref('')
const daySaveState = ref('idle')
const nightSaveState = ref('idle')
let daySaveTimer = null
let nightSaveTimer = null
let lastSavedDayConfig = ''
let lastSavedNightConfig = ''

// 设备附带信息（固件 / WiFi / 存储 / 历史），只读展示
const deviceInfo = reactive({
  firmware: { version: '', buildTime: '', pendingVerify: false, lastResult: '' },
  wifi: { ssid: '', ip: '', rssi: null, apActive: false, apSsid: '' },
  webui: { source: '', fsReady: false, fsTotalBytes: 0, fsUsedBytes: 0 },
  history: { recording: false, recentCount: 0, archiveCount: 0 }
})

const device = reactive({
  // null = 传感器暂无读数（固件返回 null）
  currentTemp: null,
  humidity: null,
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
  { value: 'on', label: '一直开' },
  { value: 'off', label: '一直关' },
  { value: 'heat', label: '按温度' }
]

const gpioOptions = [2, 3, 4, 5, 6, 7, 8, 9, 10]

const homeRelays = [
  { key: 'dayHeat', label: '日间加温' },
  { key: 'nightHeat', label: '夜间加温' },
  { key: 'uvb', label: 'UVB' }
]

const relayList = [
  { key: 'dayHeat', label: '日间加温灯', icon: '☀' },
  { key: 'uvb', label: 'UVB 灯', icon: '◌' },
  { key: 'nightHeat', label: '夜间加温灯', icon: '☾' },
  { key: 'reserved', label: '备用继电器', icon: '◇' }
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
  // 表盘的目标区间跟随当前模式
  const isNight = device.mode === 'night'
  const dayMin = Number(isNight ? device.rules.nightMinTemp : device.rules.dayMinTemp)
  const dayMax = Number(isNight ? device.rules.nightMaxTemp : device.rules.dayMaxTemp)
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
  const temp = device.currentTemp ?? lowBound
  const safeTemp = Math.min(highBound, Math.max(lowBound, Number(temp)))
  const tempCurrentDeg = ((safeTemp - lowBound) / totalRange) * gaugeArcDeg

  return {
    '--gauge-start-angle': `${gaugeStartDeg}deg`,
    '--gauge-arc-deg': `${gaugeArcDeg}deg`,
    '--temp-arc-end-deg': `${lowDeg + midDeg + highDeg}deg`,
    '--temp-progress-deg': `${tempCurrentDeg}deg`,
    '--temp-needle-angle': `${gaugeStartDeg + tempCurrentDeg}deg`
  }
})

const tempText = computed(() => (device.currentTemp == null ? '--' : device.currentTemp.toFixed(1)))

const humidityText = computed(() => (device.humidity == null ? '--' : device.humidity.toFixed(0)))

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

  if (device.currentTemp == null) {
    return '状态：传感器暂无读数，加温已关闭'
  }

  if (!device.timeSynced) {
    return '状态：时钟未同步，暂按日间模式运行'
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
  return `${String(parseHour(value)).padStart(2, '0')}:00`
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

function hasPendingRuleEdit() {
  return daySaveState.value === 'saving' || nightSaveState.value === 'saving'
}

function applyDeviceInfo(status) {
  Object.assign(deviceInfo.firmware, status.firmware ?? {})
  Object.assign(deviceInfo.wifi, status.wifi ?? {})
  Object.assign(deviceInfo.webui, status.webui ?? {})
  Object.assign(deviceInfo.history, status.history ?? {})
}

function applyStatus(status) {
  device.currentTemp = status.temperatureC ?? null
  device.humidity = status.humidity ?? null
  device.mode = status.mode ?? 'day'
  device.wifiConnected = Boolean(status.wifiConnected)
  device.timeSynced = Boolean(status.timeSynced)
  device.sensorReady = Boolean(status.sensorReady)
  device.powerEnabled = status.powerEnabled !== false
  device.manualOverride = Boolean(status.manualOverride)
  // 手动保持期结束后设备会恢复温控，到时回读一次，否则页面会一直停在手动状态
  if (device.manualOverride && !overrideRefreshTimer) {
    overrideRefreshTimer = window.setTimeout(() => {
      overrideRefreshTimer = null
      refreshStatusQuietly()
    }, MANUAL_OVERRIDE_MS + 1000)
  }
  lastSyncAt = Date.now()
  device.relays.dayHeat = Boolean(status.relays?.dayHeat)
  device.relays.nightHeat = Boolean(status.relays?.nightHeat)
  device.relays.uvb = Boolean(status.relays?.uvb)
  device.relays.relay4 = Boolean(status.relays?.relay4)

  if (status.pins) {
    applyPins(status.pins)
  }

  // 用户正在调参数（防抖保存未完成）时不用设备上的旧值覆盖界面
  if (status.rules && !hasPendingRuleEdit()) {
    applyRules(status.rules)
  }

  applyDeviceInfo(status)
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

function showToast(message, type = 'error') {
  toast.value = { message, type }
  if (toastTimer) {
    window.clearTimeout(toastTimer)
  }
  toastTimer = window.setTimeout(() => {
    toast.value = null
  }, type === 'error' ? 5000 : 2500)
}

async function syncFromEsp32() {
  busyAction.value = 'sync'

  try {
    const [status, rules] = await Promise.all([
      fetchDeviceStatus(),
      fetchDeviceRules()
    ])

    applyStatus(status)
    if (!hasPendingRuleEdit()) {
      applyRules(rules)
    }
    device.status = modeStatusText()
  } catch (error) {
    showToast(`读取设备状态失败：${error.message}`)
  } finally {
    busyAction.value = ''
  }
}

async function restoreDefaults() {
  busyAction.value = 'reset'

  try {
    await resetDeviceConfig()
    showToast('已恢复默认规则', 'success')
    await syncFromEsp32()
  } catch (error) {
    showToast(`恢复默认失败：${error.message}`)
  } finally {
    if (busyAction.value === 'reset') {
      busyAction.value = ''
    }
  }
}

// 后台回读一次状态（例如规则保存后设备已重新计算继电器）。
// 不走 syncFromEsp32：它会占用 busyAction，期间用户继续拖动滑块的修改会被跳过保存。
async function refreshStatusQuietly() {
  try {
    applyStatus(await fetchDeviceStatus())
  } catch {
    // 回读失败不提示，下次刷新页面即可
  }
}

async function autoSaveDayConfig() {
  daySaveState.value = 'saving'

  try {
    const result = await saveDeviceRules(buildRulesPayload())
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
    refreshStatusQuietly()
  } catch (error) {
    daySaveState.value = 'error'
    showToast(`日间设置保存失败：${error.message}`)
  }
}

async function autoSaveNightConfig() {
  nightSaveState.value = 'saving'

  try {
    const result = await saveDeviceRules(buildRulesPayload())
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
    refreshStatusQuietly()
  } catch (error) {
    nightSaveState.value = 'error'
    showToast(`夜间设置保存失败：${error.message}`)
  }
}

async function togglePower() {
  if (busyAction.value) {
    return
  }
  busyAction.value = 'power'
  try {
    const next = !device.powerEnabled
    await setDevicePower(next)
    device.powerEnabled = next
    device.manualOverride = false
    await syncFromEsp32()
  } catch (error) {
    showToast(`电源操作失败：${error.message}`)
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
    await toggleDeviceRelay(relay, next)
    device.relays[relay] = next
    device.manualOverride = true
    // 每次手动切换都会让设备的 60 秒保持期重新计时
    window.clearTimeout(overrideRefreshTimer)
    overrideRefreshTimer = null
    await syncFromEsp32()
  } catch (error) {
    showToast(`继电器操作失败：${error.message}`)
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

  try {
    const result = await saveDevicePins(buildPinsPayload())
    if (result?.pins) {
      applyPins(result.pins)
    }
    showToast('端口映射已保存', 'success')
  } catch (error) {
    showToast(`端口保存失败：${error.message}`)
  } finally {
    if (busyAction.value === 'pins') {
      busyAction.value = ''
    }
  }
}

async function clearHistory() {
  if (busyAction.value || !window.confirm('确定清空设备上的全部温湿度记录？此操作不可恢复。')) {
    return
  }
  busyAction.value = 'history'
  try {
    const result = await clearDeviceHistory()
    Object.assign(deviceInfo.history, result?.history ?? {})
    showToast('历史记录已清空', 'success')
  } catch (error) {
    showToast(`清空记录失败：${error.message}`)
  } finally {
    if (busyAction.value === 'history') {
      busyAction.value = ''
    }
  }
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

const webUiSourceLabel = computed(() => {
  const source = deviceInfo.webui.source
  if (source === 'uploaded') return '已上传版本'
  if (source === 'builtin') return '固件内置版本'
  return '—'
})

const wifiSignalLabel = computed(() => {
  const rssi = Number(deviceInfo.wifi.rssi)
  if (!device.wifiConnected || !Number.isFinite(rssi) || rssi === 0) return '—'
  const level = rssi >= -60 ? '强' : rssi >= -72 ? '中' : '弱'
  return `${level}（${rssi} dBm）`
})

const deviceInfoRows = computed(() => [
  { label: '固件版本', value: deviceInfo.firmware.version || '—' },
  { label: 'WiFi', value: device.wifiConnected ? deviceInfo.wifi.ssid || '—' : '未连接' },
  { label: 'IP 地址', value: device.wifiConnected ? deviceInfo.wifi.ip || '—' : '—' },
  { label: '信号', value: wifiSignalLabel.value },
  { label: '网页', value: webUiSourceLabel.value },
  {
    label: '存储',
    value: deviceInfo.webui.fsReady
      ? `${formatBytes(deviceInfo.webui.fsUsedBytes)} / ${formatBytes(deviceInfo.webui.fsTotalBytes)}`
      : '不可用'
  }
])

// 手机锁屏或切到别的 App 再回来时，页面还停在离开时的数据
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && Date.now() - lastSyncAt > STALE_AFTER_MS && !busyAction.value) {
    syncFromEsp32()
  }
}

// 打开页面时读取一次；之后靠操作后的回读、回到前台或用户刷新页面更新
onMounted(() => {
  syncFromEsp32()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  window.clearTimeout(overrideRefreshTimer)
  if (daySaveTimer) {
    window.clearTimeout(daySaveTimer)
  }
  if (nightSaveTimer) {
    window.clearTimeout(nightSaveTimer)
  }
  if (toastTimer) {
    window.clearTimeout(toastTimer)
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
          <h1>Sun Box</h1>
        </div>
        <span class="mode-chip" :class="device.mode">{{ device.mode === 'night' ? '☾ 夜间' : '☀ 日间' }}</span>
      </header>

      <main class="content">
        <section v-if="activeTab === 'home'" class="screen">
          <div class="card hero-card">
            <div class="gauge-ring" :style="gaugeArcStyle">
              <div class="gauge-arc gauge-arc-track"></div>
              <div class="gauge-arc gauge-arc-temp"></div>
              <div class="gauge-needle gauge-needle-temp">
                <span class="gauge-needle-bar"></span>
              </div>
              <div class="gauge-center">
                <div class="gauge-center-eyebrow">实时温度</div>
                <div class="gauge-value">{{ tempText }}<span>°C</span></div>
                <div class="gauge-sub">湿度 {{ humidityText }}%</div>
              </div>
            </div>
            <p class="hero-status">{{ device.status }}</p>
          </div>

          <div class="card list-card">
            <div class="list-row" :class="{ 'is-off': !device.powerEnabled }">
              <div class="list-text">
                <strong>总电源</strong>
                <small v-if="device.manualOverride">手动控制中，自动加温已暂停</small>
                <small v-else-if="device.powerEnabled">断开后所有继电器立即锁定</small>
                <small v-else>已关闭，所有继电器已断开</small>
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
          </div>

          <p class="section-label">手动控制</p>
          <div class="card list-card" :class="{ 'is-locked': !device.powerEnabled }">
            <div v-for="relay in homeRelays" :key="`home-relay-${relay.key}`" class="list-row">
              <div class="list-text">
                <strong>{{ relay.label }}</strong>
              </div>
              <label class="toggle-switch" :aria-label="relay.label">
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
          <p class="hint">{{ device.powerEnabled ? '手动切换灯后保持 60 秒，之后自动恢复温控。' : '总电源已关闭，打开后才能手动控制。' }}</p>
        </section>

        <section v-else-if="activeTab === 'day'" class="screen">
          <div class="page-header">
            <h2>日间设置</h2>
            <span class="autosave-badge" :class="daySaveState">{{ daySaveLabel }}</span>
          </div>

          <div class="card slider-card">
            <div class="slider-title">
              <span>时间窗口</span>
              <strong>
                {{ formatHourLabel(device.rules.dayStart) }} – {{ formatHourLabel(device.rules.nightStart) }}
                <em>{{ calculateWindowHours(device.rules.dayStart, device.rules.nightStart) }} 小时</em>
              </strong>
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
              <span>拖动设置日间开始</span>
              <span>夜间开始在夜间页设置</span>
            </div>
          </div>

          <div class="card slider-card">
            <div class="slider-title">
              <span>温度范围</span>
              <strong>{{ device.rules.dayMinTemp.toFixed(1) }} – {{ device.rules.dayMaxTemp.toFixed(1) }}°C</strong>
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
              <span>下限</span>
              <span>上限</span>
            </div>
          </div>

          <p class="section-label">灯怎么开</p>
          <div class="card list-card">
            <div v-for="relay in relayList" :key="`day-${relay.key}`" class="list-row">
              <div class="list-text">
                <strong><span class="row-icon">{{ relay.icon }}</span>{{ relay.label }}</strong>
              </div>
              <div class="segmented">
                <button
                  v-for="option in relayModeOptions"
                  :key="`day-${relay.key}-${option.value}`"
                  type="button"
                  :class="{ active: relayRoleMode('day', relay.key) === option.value }"
                  @click="setRelayRoleMode('day', relay.key, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
          <p class="hint">按温度：低于温度范围下限时开灯，高于上限时关灯。</p>
        </section>

        <section v-else-if="activeTab === 'night'" class="screen">
          <div class="page-header">
            <h2>夜间设置</h2>
            <span class="autosave-badge" :class="nightSaveState">{{ nightSaveLabel }}</span>
          </div>

          <div class="card slider-card">
            <div class="slider-title">
              <span>时间窗口</span>
              <strong>
                {{ formatHourLabel(device.rules.nightStart) }} – {{ formatHourLabel(device.rules.dayStart) }}
                <em>{{ calculateWindowHours(device.rules.nightStart, device.rules.dayStart) }} 小时</em>
              </strong>
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
              <span>拖动设置夜间开始</span>
              <span>日间开始在日间页设置</span>
            </div>
          </div>

          <div class="card slider-card">
            <div class="slider-title">
              <span>温度范围</span>
              <strong>{{ device.rules.nightMinTemp.toFixed(1) }} – {{ device.rules.nightMaxTemp.toFixed(1) }}°C</strong>
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
              <span>下限</span>
              <span>上限</span>
            </div>
          </div>

          <p class="section-label">灯怎么开</p>
          <div class="card list-card">
            <div v-for="relay in relayList" :key="`night-${relay.key}`" class="list-row">
              <div class="list-text">
                <strong><span class="row-icon">{{ relay.icon }}</span>{{ relay.label }}</strong>
              </div>
              <div class="segmented">
                <button
                  v-for="option in relayModeOptions"
                  :key="`night-${relay.key}-${option.value}`"
                  type="button"
                  :class="{ active: relayRoleMode('night', relay.key) === option.value }"
                  @click="setRelayRoleMode('night', relay.key, option.value)"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
          </div>
          <p class="hint">按温度：低于温度范围下限时开灯，高于上限时关灯。</p>
        </section>

        <section v-else-if="activeTab === 'history'" class="screen">
          <HistoryPanel />
        </section>

        <section v-else class="screen">
          <div class="page-header">
            <h2>系统</h2>
          </div>

          <p class="section-label">端口映射</p>
          <div class="card list-card">
            <label v-for="item in pinRelayList" :key="`pin-${item.key}`" class="list-row">
              <div class="list-text">
                <strong>{{ item.label }}</strong>
              </div>
              <select v-model="device.pins[item.key]" class="port-select">
                <option v-for="gpio in gpioOptions" :key="`pin-${item.key}-${gpio}`" :value="gpio">
                  IO{{ gpio }}
                </option>
              </select>
            </label>
          </div>
          <p class="hint">可选 IO2–IO10，四路需互不相同，保存后立即生效。</p>
          <div class="action-row">
            <button type="button" class="primary-button" :disabled="busyAction !== ''" @click="submitPins">
              保存端口映射
            </button>
            <button type="button" class="ghost-button" :disabled="busyAction !== ''" @click="restoreDefaults">
              恢复默认规则
            </button>
          </div>

          <p class="section-label">
            设备信息
            <span v-if="deviceInfo.firmware.pendingVerify" class="badge warn">新固件待确认</span>
          </p>
          <div class="card list-card">
            <div v-for="row in deviceInfoRows" :key="`info-${row.label}`" class="list-row info-row">
              <span>{{ row.label }}</span>
              <strong>{{ row.value }}</strong>
            </div>
          </div>
          <p v-if="deviceInfo.firmware.lastResult" class="hint">最近一次升级：{{ deviceInfo.firmware.lastResult }}</p>
          <div class="action-row">
            <a class="ghost-button" href="/update" target="_blank" rel="noopener">固件 / 网页升级</a>
            <a class="ghost-button" href="/wifi" target="_blank" rel="noopener">WiFi 配网</a>
          </div>

          <p class="section-label">
            历史记录
            <span class="badge" :class="deviceInfo.history.recording ? 'ok' : ''">
              {{ deviceInfo.history.recording ? '记录中' : '未记录' }}
            </span>
          </p>
          <div class="card list-card">
            <div class="list-row info-row">
              <span>最近 7 天</span>
              <strong>{{ deviceInfo.history.recentCount }} 条</strong>
            </div>
            <div class="list-row info-row">
              <span>长期记录</span>
              <strong>{{ deviceInfo.history.archiveCount }} 条</strong>
            </div>
          </div>
          <p v-if="!deviceInfo.history.recording" class="hint">设备时间同步（连上 WiFi）后才会开始记录。</p>
          <div class="action-row">
            <button type="button" class="ghost-button" @click="activeTab = 'history'">查看记录</button>
            <button type="button" class="ghost-button danger" :disabled="busyAction !== ''" @click="clearHistory">
              清空记录
            </button>
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

      <Transition name="toast">
        <div v-if="toast" class="toast" :class="toast.type" role="alert" @click="toast = null">
          {{ toast.message }}
        </div>
      </Transition>
    </div>
  </div>
</template>

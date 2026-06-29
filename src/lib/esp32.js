const DEFAULT_BASE_URL = 'http://192.168.4.1'
const MOCK_MODE_KEY = 'sunbox-mock-mode'
const MOCK_CONFIG_KEY = 'sunbox-mock-config'

const defaultMockConfig = {
  dayStart: '08:00',
  nightStart: '20:00',
  dayMinTemp: 30.0,
  dayMaxTemp: 32.0,
  nightMinTemp: 26.0,
  nightMaxTemp: 28.0
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function readMockConfig() {
  const saved = localStorage.getItem(MOCK_CONFIG_KEY)
  if (!saved) {
    return { ...defaultMockConfig }
  }

  try {
    return { ...defaultMockConfig, ...JSON.parse(saved) }
  } catch {
    return { ...defaultMockConfig }
  }
}

function writeMockConfig(config) {
  localStorage.setItem(MOCK_CONFIG_KEY, JSON.stringify(config))
}

function buildMockStatus() {
  const config = readMockConfig()
  const hour = new Date().getHours()
  const dayStartHour = Number.parseInt(config.dayStart.slice(0, 2), 10)
  const nightStartHour = Number.parseInt(config.nightStart.slice(0, 2), 10)
  const isNight = hour >= nightStartHour || hour < dayStartHour

  return {
    mode: isNight ? 'night' : 'day',
    temperatureC: isNight ? 26.4 : 31.8,
    humidity: isNight ? 68.2 : 59.4,
    wifiConnected: true,
    timeSynced: true,
    sensorReady: true,
    relays: {
      dayHeat: !isNight && false,
      nightHeat: isNight && true,
      uvb: !isNight
    },
    config
  }
}

export function getEsp32BaseUrl() {
  return localStorage.getItem('sunbox-esp32-base-url') || DEFAULT_BASE_URL
}

export function setEsp32BaseUrl(url) {
  localStorage.setItem('sunbox-esp32-base-url', url.trim())
}

export function getMockMode() {
  return localStorage.getItem(MOCK_MODE_KEY) !== 'false'
}

export function setMockMode(enabled) {
  localStorage.setItem(MOCK_MODE_KEY, String(enabled))
}

async function request(path, options = {}, baseUrl = getEsp32BaseUrl()) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Accept: 'application/json',
      ...options.headers
    },
    ...options
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const detail = data?.error || `ESP32 responded with ${response.status}`
    throw new Error(detail)
  }

  return data
}

export function fetchDeviceStatus(baseUrl = getEsp32BaseUrl()) {
  return request('/api/status', {}, baseUrl)
}

export function fetchDeviceConfig(baseUrl = getEsp32BaseUrl()) {
  return request('/api/config', {}, baseUrl)
}

export function saveDeviceConfig(config, baseUrl = getEsp32BaseUrl()) {
  return request(
    '/api/config',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(config)
    },
    baseUrl
  )
}

export function resetDeviceConfig(baseUrl = getEsp32BaseUrl()) {
  return request(
    '/api/config/reset',
    {
      method: 'POST'
    },
    baseUrl
  )
}

export async function fetchMockDeviceStatus() {
  await sleep(280)
  return buildMockStatus()
}

export async function fetchMockDeviceConfig() {
  await sleep(180)
  return readMockConfig()
}

export async function saveMockDeviceConfig(config) {
  await sleep(320)
  const nextConfig = {
    dayStart: config.dayStart,
    nightStart: config.nightStart,
    dayMinTemp: Number(config.dayMinTemp),
    dayMaxTemp: Number(config.dayMaxTemp),
    nightMinTemp: Number(config.nightMinTemp),
    nightMaxTemp: Number(config.nightMaxTemp)
  }
  writeMockConfig(nextConfig)
  return {
    ok: true,
    config: nextConfig
  }
}

export async function resetMockDeviceConfig() {
  await sleep(260)
  writeMockConfig(defaultMockConfig)
  return {
    ok: true,
    message: 'config reset to default'
  }
}

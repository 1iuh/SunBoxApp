// 默认使用与页面相同的域（同源）：面板和 ESP32 由同一台 HTTP 服务托管时留空即可
const DEFAULT_BASE_URL = ''
const BASE_URL_COOKIE = 'sunbox-esp32-base-url'

function readCookie(name) {
  const prefix = `${name}=`
  const entries = document.cookie ? document.cookie.split(';') : []
  for (const entry of entries) {
    const trimmed = entry.trim()
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length))
      } catch {
        return trimmed.slice(prefix.length)
      }
    }
  }
  return ''
}

function writeCookie(name, value) {
  // expires in the year 9999 → effectively infinite lifetime
  const encoded = encodeURIComponent(value)
  const expires = `expires=Tue, 31 Dec 9999 23:59:59 GMT`
  document.cookie = `${name}=${encoded}; ${expires}; path=/; SameSite=Lax`
}

export function getEsp32BaseUrl() {
  return readCookie(BASE_URL_COOKIE) || DEFAULT_BASE_URL
}

export function setEsp32BaseUrl(url) {
  writeCookie(BASE_URL_COOKIE, url.trim())
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

function postJson(path, body, baseUrl = getEsp32BaseUrl()) {
  return request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    },
    baseUrl
  )
}

// GET /api/status — runtime status, sensor state, relay state, pins and active rules.
export function fetchDeviceStatus(baseUrl = getEsp32BaseUrl()) {
  return request('/api/status', {}, baseUrl)
}

// GET /api/rules — persisted mode rules (schedule, thresholds, per-relay roles).
export function fetchDeviceRules(baseUrl = getEsp32BaseUrl()) {
  return request('/api/rules', {}, baseUrl)
}

// POST /api/rules — update the full mode-rule configuration.
export function saveDeviceRules(rules, baseUrl = getEsp32BaseUrl()) {
  return postJson('/api/rules', rules, baseUrl)
}

// POST /api/config/reset — reset mode rules to firmware defaults.
export function resetDeviceConfig(baseUrl = getEsp32BaseUrl()) {
  return request('/api/config/reset', { method: 'POST' }, baseUrl)
}

// POST /api/power — global power switch.
export function setDevicePower(on, baseUrl = getEsp32BaseUrl()) {
  return postJson('/api/power', { on }, baseUrl)
}

// POST /api/relays — manually toggle a single relay (60s manual override).
export function toggleDeviceRelay(relay, on, baseUrl = getEsp32BaseUrl()) {
  return postJson('/api/relays', { relay, on }, baseUrl)
}

// GET /api/pins — current relay-to-pin mapping.
export function fetchDevicePins(baseUrl = getEsp32BaseUrl()) {
  return request('/api/pins', {}, baseUrl)
}

// POST /api/pins — update the relay-to-pin mapping.
export function saveDevicePins(pins, baseUrl = getEsp32BaseUrl()) {
  return postJson('/api/pins', pins, baseUrl)
}

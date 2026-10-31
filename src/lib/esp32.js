// 网页由 ESP32 自己托管，所有请求都发往同源的 /api/*。
// 本地调试（npm run dev）时由 vite.config.js 的代理转发到设备，见 SUNBOX_DEVICE。

async function request(path, options = {}) {
  const response = await fetch(path, {
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

function postJson(path, body) {
  return request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

// GET /api/status — runtime status, sensor state, relay state, pins and active rules.
export function fetchDeviceStatus() {
  return request('/api/status')
}

// GET /api/rules — persisted mode rules (schedule, thresholds, per-relay roles).
export function fetchDeviceRules() {
  return request('/api/rules')
}

// POST /api/rules — update the full mode-rule configuration.
export function saveDeviceRules(rules) {
  return postJson('/api/rules', rules)
}

// POST /api/config/reset — reset mode rules to firmware defaults.
export function resetDeviceConfig() {
  return request('/api/config/reset', { method: 'POST' })
}

// POST /api/power — global power switch.
export function setDevicePower(on) {
  return postJson('/api/power', { on })
}

// POST /api/relays — manually toggle a single relay (60s manual override).
export function toggleDeviceRelay(relay, on) {
  return postJson('/api/relays', { relay, on })
}

// GET /api/pins — current relay-to-pin mapping.
export function fetchDevicePins() {
  return request('/api/pins')
}

// POST /api/pins — update the relay-to-pin mapping.
export function saveDevicePins(pins) {
  return postJson('/api/pins', pins)
}

// GET /api/history — temperature/humidity history (part: recent | archive | all).
export function fetchDeviceHistory(part = 'all') {
  return request(`/api/history?part=${encodeURIComponent(part)}`)
}

// POST /api/history/clear — delete all stored history.
export function clearDeviceHistory() {
  return request('/api/history/clear', { method: 'POST' })
}

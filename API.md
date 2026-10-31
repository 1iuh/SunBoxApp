# SunBox API Documentation

## Overview

SunBox exposes a small HTTP API for status queries and configuration updates.

- Base protocol: `HTTP`
- Default port: `80`
- Response format: `application/json`
- CORS: all responses include `Access-Control-Allow-Origin: *`; OPTIONS preflight returns `204`
- Device role: temperature control system for day/night modes
- Network: WiFi credentials are configured at runtime (config AP `SunBox-XXXX` / password `sunbox123` + captive portal, or `POST /api/wifi`). The HTTP server is reachable on the LAN IP and, while the config AP is on, at `192.168.4.1`.
- No authentication on any endpoint, including firmware upload.

## Hardware Mapping

- AHT20 I2C SDA: `IO1` (fixed by wiring, not configurable)
- AHT20 I2C SCL: `IO0` (fixed by wiring, not configurable)
- Relay 1 Day Heat: `IO3` (default; configurable via `POST /api/pins`)
- Relay 2 Night Heat: `IO4` (default; configurable via `POST /api/pins`)
- Relay 3 Day UVB: `IO5` (default; configurable via `POST /api/pins`)
- Relay 4 Reserved: `IO7` (default; configurable via `POST /api/pins`)

## Control Logic

The device switches between `day` and `night` mode based on the configured time range (`dayStart` .. `nightStart`). NTP not yet synced falls back to `day` mode.

Within each mode, every relay is driven by a configurable **role** (integer):

| Role value | Name | Behavior |
| --- | --- | --- |
| `0` | `off` | Always off |
| `1` | `on` | Always on |
| `2` | `heat` | Hysteresis heating: on below `minTemp`, off above `maxTemp`, holds in between. If temperature is unavailable, stays off (safe default). |

The four relays (`heat`, `nightHeat`, `uvb`, `reserved`) each have an independent role per mode, plus per-mode `minTemp`/`maxTemp` thresholds. This is fully configurable via `POST /api/rules`.

Precedence (highest wins): global power switch off → manual relay override (60s) → auto mode rules.

## Endpoints

### `GET /`

Returns the web UI: the uploaded one (see *Serving the Web UI*) if present, otherwise the
bundled one (gzip-compressed HTML). Bundling requires that `web_assets.gz.h` was
generated before compiling (run `tools/gen_web_assets.ps1` after dropping the `*.gz`
files into `web/`). If neither exists, falls back to a JSON API description.

The build script recursively scans `web/` for `*.gz` and maps each to a request path
(`web/` is the web root, `.gz` suffix stripped). This supports Vite-style hashed output
(e.g. `web/assets/index-C2VtJ0GX.css.gz` → `/assets/index-C2VtJ0GX.css`); the firmware
looks assets up by path, so hash changes need no code edits.

**Bundled (web assets present):**

| Header | Value |
| --- | --- |
| `Content-Type` | inferred from extension (`text/html`, `text/css`, ...) |
| `Content-Encoding` | `gzip` |
| `Cache-Control` | `no-cache` for HTML, `max-age=86400` for other assets |

Other bundled assets (any `*.gz` under `web/`, e.g. `/assets/*`) are served the same
way via path lookup in `handleNotFound`. MIME is inferred by extension; unmapped paths
return `404`.

**Fallback (no web assets bundled):**

```json
{
  "name": "SunBox",
  "message": "Use /api/status, /api/rules, /api/config/reset, /api/power, /api/relays, /api/pins, /api/wifi, /api/history; upload firmware / web ui at /update",
  "configPostFormat": "JSON or form fields"
}
```

### `GET /api/status`

Returns current runtime status, sensor state, relay state, pins, and active config.

#### Response Fields

- `firmwareVersion`: `FIRMWARE_VERSION` of the running firmware
- `mode`: current control mode, `day` or `night`
- `temperatureC`: current temperature in Celsius, or `null` if unavailable
- `humidity`: current humidity, or `null` if unavailable
- `wifiConnected`: whether WiFi is connected
- `timeSynced`: whether NTP time service has been started
- `sensorReady`: whether AHT20 initialized successfully
- `powerEnabled`: whether the global power switch is on (when off, all relays are forced off and locked)
- `manualOverride`: `true` when a relay is currently under manual control (auto temperature control paused); `false` when auto control is active
- `pins`: current pin mapping
- `relays`: current relay output state
- `rules`: current active mode rules (schedule + temperature thresholds + per-relay roles)
- `webui`: web UI source and stored files (same as `GET /api/webui`)
- `wifi`: WiFi state (same as `GET /api/wifi`)
- `firmware`: firmware info (same as `GET /api/firmware`)
- `history`: history recording state: `recording` (LittleFS mounted and NTP time valid), `recentCount` / `archiveCount` (records stored in each file)

#### Response Example

```json
{
  "firmwareVersion": "1.1.0",
  "mode": "day",
  "temperatureC": 30.42,
  "humidity": 61.15,
  "wifiConnected": true,
  "timeSynced": true,
  "sensorReady": true,
  "powerEnabled": true,
  "manualOverride": false,
  "pins": {
    "i2cSda": 1,
    "i2cScl": 0,
    "relayDayHeat": 3,
    "relayNightHeat": 4,
    "relayDayUvb": 5,
    "relay4": 7
  },
  "relays": {
    "dayHeat": false,
    "nightHeat": false,
    "uvb": true,
    "relay4": false
  },
  "rules": {
    "dayStart": "08:00",
    "nightStart": "20:00",
    "dayMinTemp": 30.0,
    "dayMaxTemp": 32.0,
    "dayHeatRole": 2,
    "dayNightHeatRole": 0,
    "dayUvbRole": 1,
    "dayReservedRole": 0,
    "nightMinTemp": 26.0,
    "nightMaxTemp": 28.0,
    "nightHeatRole": 0,
    "nightNightHeatRole": 2,
    "nightUvbRole": 0,
    "nightReservedRole": 0
  },
  "webui": { "source": "builtin", "fsReady": true, "fsTotalBytes": 393216, "fsUsedBytes": 16384, "files": [] },
  "wifi": { "configured": true, "ssid": "HomeWiFi", "connected": true, "ip": "192.168.31.125", "rssi": -58, "lastError": "", "apActive": false, "apSsid": "SunBox-1A2B", "apIp": "" },
  "firmware": { "version": "1.1.0", "buildTime": "Oct 31 2026 14:02:11", "maxSizeBytes": 1835008, "pendingVerify": false, "lastResult": "" },
  "history": { "recording": true, "recentCount": 1008, "archiveCount": 212 }
}
```

### `GET /api/rules`

Returns the persisted mode rules currently used by the device (schedule, per-mode temperature thresholds, and each relay's role in each mode).

#### Response Example

```json
{
  "dayStart": "08:00",
  "nightStart": "20:00",
  "dayMinTemp": 30.0,
  "dayMaxTemp": 32.0,
  "dayHeatRole": 2,
  "dayNightHeatRole": 0,
  "dayUvbRole": 1,
  "dayReservedRole": 0,
  "nightMinTemp": 26.0,
  "nightMaxTemp": 28.0,
  "nightHeatRole": 0,
  "nightNightHeatRole": 2,
  "nightUvbRole": 0,
  "nightReservedRole": 0
}
```

### `POST /api/rules`

Updates the full mode-rule configuration: day/night start times, per-mode temperature thresholds, and each relay's role in each mode. Persisted to NVS and applied immediately.

Supports:

- JSON request body
- Form fields

#### JSON Request Example

```json
{
  "dayStart": "08:00",
  "nightStart": "20:00",
  "dayMinTemp": 30.0,
  "dayMaxTemp": 32.0,
  "dayHeatRole": 2,
  "dayNightHeatRole": 0,
  "dayUvbRole": 1,
  "dayReservedRole": 0,
  "nightMinTemp": 26.0,
  "nightMaxTemp": 28.0,
  "nightHeatRole": 0,
  "nightNightHeatRole": 2,
  "nightUvbRole": 0,
  "nightReservedRole": 0
}
```

#### Request Fields

Schedule:
- `dayStart`: day mode start time, `HH:MM`
- `nightStart`: night mode start time, `HH:MM`

Per-mode thresholds:
- `dayMinTemp` / `dayMaxTemp`: day mode temperature bounds
- `nightMinTemp` / `nightMaxTemp`: night mode temperature bounds

Per-mode relay roles (integer `0`=off, `1`=on, `2`=heat):
- `dayHeatRole`, `dayNightHeatRole`, `dayUvbRole`, `dayReservedRole`: role of each relay during **day** mode
- `nightHeatRole`, `nightNightHeatRole`, `nightUvbRole`, `nightReservedRole`: role of each relay during **night** mode

#### Validation Rules

- `dayStart` and `nightStart` must use `HH:MM` (`00:00`–`23:59`)
- `dayMinTemp <= dayMaxTemp`
- `nightMinTemp <= nightMaxTemp`
- Every role must be `0`, `1`, or `2`
- All fields are required

#### Success Response Example

```json
{
  "ok": true,
  "rules": {
    "dayStart": "08:00",
    "nightStart": "20:00",
    "dayMinTemp": 30.0,
    "dayMaxTemp": 32.0,
    "dayHeatRole": 2,
    "dayNightHeatRole": 0,
    "dayUvbRole": 1,
    "dayReservedRole": 0,
    "nightMinTemp": 26.0,
    "nightMaxTemp": 28.0,
    "nightHeatRole": 0,
    "nightNightHeatRole": 2,
    "nightUvbRole": 0,
    "nightReservedRole": 0
  }
}
```

#### Error Responses

Invalid JSON body:

```json
{
  "error": "invalid json body"
}
```

Missing fields:

```json
{
  "error": "missing required fields"
}
```

Invalid configuration (bad time, min>max, or role out of range):

```json
{
  "error": "invalid configuration"
}
```

### `POST /api/config/reset`

Resets **all** mode-rule configuration (schedule, thresholds, and relay roles) to firmware defaults and immediately applies it. (Relay pin mapping and WiFi are not affected.)

#### Success Response Example

```json
{
  "ok": true,
  "message": "config reset to default"
}
```

### `POST /api/power`

Global power switch. When turned off, all relays are forced off and locked until power is turned on again. Switching power also clears any active manual override.

Supports:

- JSON request body
- Form fields

#### JSON Request Example

```json
{
  "on": false
}
```

#### Form Request Example

```text
on=false
```

#### Request Fields

- `on`: boolean. `true` to enable the system (resume auto control), `false` to cut all relays.

`on` accepts `true`/`false` or `1`/`0`.

#### Success Response Example

```json
{
  "ok": true,
  "powerEnabled": false
}
```

#### Error Responses

Missing/invalid `on`:

```json
{
  "error": "missing required field 'on'"
}
```

### `POST /api/relays`

Manually toggles a single relay. Enters a 60-second manual override window during which auto temperature control is paused; each call refreshes the window. After the window expires, auto temperature control resumes.

The default relay-to-pin mapping is `IO3` (day heat), `IO4` (night heat), `IO5` (UVB), `IO7` (reserved); this mapping can be changed via `POST /api/pins`. The `relay` field below always refers to the logical relay role, regardless of which physical GPIO it is currently bound to.

Supports:

- JSON request body
- Form fields

#### JSON Request Example

```json
{
  "relay": "uvb",
  "on": true
}
```

#### Form Request Example

```text
relay=uvb&on=true
```

#### Request Fields

- `relay`: one of `dayHeat`, `nightHeat`, `uvb`, `reserved`
- `on`: boolean. `true` to turn the relay on, `false` to turn it off.

`on` accepts `true`/`false` or `1`/`0`.

#### Validation Rules

- `relay` must be one of `dayHeat`, `nightHeat`, `uvb`, `reserved`
- `on` must be present
- The global power switch must be on; calling this while power is off returns `409`

#### Success Response Example

```json
{
  "ok": true,
  "relay": "uvb",
  "on": true,
  "manualOverrideMs": 60000
}
```

#### Error Responses

Missing/invalid fields:

```json
{
  "error": "missing required fields 'relay' and 'on'"
}
```

Invalid relay name:

```json
{
  "error": "invalid relay, must be dayHeat|nightHeat|uvb|reserved"
}
```

Power is off:

```json
{
  "error": "power is off, turn on power first via POST /api/power"
}
```

### `GET /api/pins`

Returns the current relay-to-pin mapping.

#### Response Example

```json
{
  "i2cSda": 1,
  "i2cScl": 0,
  "relayDayHeat": 3,
  "relayNightHeat": 4,
  "relayDayUvb": 5,
  "relay4": 7
}
```

> Note: `i2cSda` / `i2cScl` are fixed by hardware wiring and are not configurable. Only the four relay pins can be changed.

### `POST /api/pins`

Updates the relay-to-pin mapping. The new mapping is persisted to NVS and survives reboot. On update, all current relay outputs are safely turned off first, then the new pins are re-initialized.

Supports:

- JSON request body
- Form fields

#### JSON Request Example

```json
{
  "relayDayHeat": 3,
  "relayNightHeat": 4,
  "relayDayUvb": 5,
  "relay4": 7
}
```

#### Form Request Example

```text
relayDayHeat=3&relayNightHeat=4&relayDayUvb=5&relay4=7
```

#### Request Fields

- `relayDayHeat`: GPIO number for the day heating relay
- `relayNightHeat`: GPIO number for the night heating relay
- `relayDayUvb`: GPIO number for the day UVB relay
- `relay4`: GPIO number for the reserved relay

#### Validation Rules

- Each pin must be a safe ESP32-C3 output GPIO. Allowed: `2, 3, 4, 5, 6, 7, 8, 9, 10`
  - Excluded: `0`/`1` (I2C), `11`-`17` (SPI flash), `18`/`19` (USB), `20`/`21` (UART)
- The four pins must be unique
- All four fields are required

#### Success Response Example

```json
{
  "ok": true,
  "pins": {
    "i2cSda": 1,
    "i2cScl": 0,
    "relayDayHeat": 3,
    "relayNightHeat": 4,
    "relayDayUvb": 5,
    "relay4": 7
  }
}
```

#### Error Responses

Invalid/missing fields:

```json
{
  "error": "missing required fields"
}
```

Pin out of allowed set:

```json
{
  "error": "invalid pin, allowed GPIO: 2,3,4,5,6,7,8,9,10"
}
```

Duplicate pins:

```json
{
  "error": "pins must be unique"
}
```

### `GET /wifi`

WiFi setup page (HTML, built into the firmware). While the config AP is active, any request for a foreign host (phone connectivity checks) is redirected here with `302`, so phones pop the page up automatically (captive portal). Also reachable on the LAN at `http://<device-ip>/wifi`.

### `GET /api/wifi`

Returns WiFi state. Also embedded as the `wifi` field of `GET /api/status`. The password is never returned.

#### Response Fields

- `configured`: `true` when an SSID is stored
- `ssid`: stored SSID (empty when not configured)
- `connected`: whether the station interface is connected
- `ip`: station IP (empty when not connected)
- `rssi`: signal strength in dBm, or `null` when not connected
- `lastError`: reason of the last failed connection attempt (`ssid not found`, `connect failed (wrong password?)`, `connect timeout`), empty after a successful connection
- `apActive`: whether the config AP is on
- `apSsid`: config AP name, `SunBox-XXXX` (last 4 hex digits of the MAC)
- `apIp`: config AP IP (`192.168.4.1`), empty when the AP is off

#### Response Example

```json
{
  "configured": true,
  "ssid": "HomeWiFi",
  "connected": true,
  "ip": "192.168.31.125",
  "rssi": -58,
  "lastError": "",
  "apActive": false,
  "apSsid": "SunBox-1A2B",
  "apIp": ""
}
```

### `POST /api/wifi`

Saves new WiFi credentials (persisted to NVS) and immediately reconnects with them. The current connection is dropped, so when called over the LAN the device moves to the new network; if it cannot connect, the config AP comes back after 60 s.

Supports:

- JSON request body
- Form fields

#### JSON Request Example

```json
{
  "ssid": "HomeWiFi",
  "password": "secret-pass"
}
```

#### Request Fields

- `ssid`: required, 1–32 chars
- `password`: optional; empty for an open network, otherwise 8–63 chars

#### Success Response Example

```json
{
  "ok": true,
  "wifi": { "configured": true, "ssid": "HomeWiFi", "connected": false, "...": "..." }
}
```

#### Error Responses

```json
{ "error": "ssid must be 1..32 chars" }
```

```json
{ "error": "password must be empty or 8..63 chars" }
```

### `GET /api/wifi/scan`

Scans nearby networks asynchronously. The first call (or a call after the 30 s cache expires) starts a scan and returns `"scanning": true`; poll until `scanning` is `false`. Duplicate SSIDs are listed once (strongest signal first).

```json
{
  "scanning": false,
  "networks": [
    { "ssid": "HomeWiFi", "rssi": -52, "secure": true },
    { "ssid": "Guest", "rssi": -70, "secure": false }
  ]
}
```

### `GET /update`

Upload page (HTML, built into the firmware, works even if the web UI is broken). Uploads firmware via `POST /api/firmware` and the web UI via the `/api/webui/*` sequence below.

### `GET /api/firmware`

Returns firmware info. Also embedded as the `firmware` field of `GET /api/status`.

- `version`: `FIRMWARE_VERSION` from the source
- `buildTime`: compile date/time
- `maxSizeBytes`: largest firmware image that fits the OTA partition
- `pendingVerify`: `true` right after an upload until the new firmware connects to WiFi (see rollback below)
- `lastResult`: outcome of the last upload / verification, e.g. `installed, rebooting`, `firmware 1.1.0 verified`, `image verify failed: ...`

```json
{
  "version": "1.1.0",
  "buildTime": "Oct 31 2026 14:02:11",
  "maxSizeBytes": 1835008,
  "pendingVerify": false,
  "lastResult": "firmware 1.1.0 verified"
}
```

### `POST /api/firmware`

Uploads a firmware image (`SunBox.ino.bin` from the build output) as `multipart/form-data` (any file field name). The image is streamed into the inactive OTA partition; ESP-IDF validates it (magic byte, chip type, checksum) before switching the boot partition. On success the device responds and reboots ~1.5 s later.

```bash
curl -F "firmware=@SunBox.ino.bin" http://192.168.31.125/api/firmware
```

- `200` `{"ok":true,"message":"firmware installed, rebooting"}`
- `400` `{"ok":false,"error":"..."}`, e.g. `image verify failed: ...`, `write failed: ...`, `empty file`, `upload aborted`. The running firmware is untouched.

**Rollback:** after an upload the new firmware boots in a pending-verify state. It is confirmed as soon as it connects to WiFi. If it does not connect within 5 minutes, or crashes/reboots before that, the bootloader rolls back to the previous firmware.

### `GET /api/webui`

Returns the web UI source and stored files. Also embedded as the `webui` field of `GET /api/status`.

- `source`: `uploaded` (served from LittleFS), `builtin` (compiled-in `web_assets.gz.h`), or `none`
- `fsReady`: whether LittleFS is mounted (requires flashing over USB with the repo's `partitions.csv`)
- `fsTotalBytes` / `fsUsedBytes`: LittleFS capacity and usage
- `files`: uploaded files, paths relative to the web root

```json
{
  "source": "uploaded",
  "fsReady": true,
  "fsTotalBytes": 393216,
  "fsUsedBytes": 65536,
  "files": [
    { "path": "/index.html.gz", "size": 543 },
    { "path": "/assets/index-C2VtJ0GX.css.gz", "size": 4283 },
    { "path": "/assets/index-P9HrwScv.js.gz", "size": 32812 }
  ]
}
```

### Web UI upload sequence

Uploaded files go to a staging directory first and replace the live UI only on commit, so a failed upload never leaves a half-updated UI.

1. `POST /api/webui/begin`: clears the staging directory. `{"ok":true}`
2. `POST /api/webui/upload?path=/assets/index-x.js.gz`: one `multipart/form-data` file per request. `path` is the file's path relative to the web root, **including** `.gz`, so the mapping is the same as `tools/gen_web_assets.ps1`. Allowed characters: letters, digits, `.` `_` `-` `/`; no `..`; max 96 chars. Response: `{"ok":true,"path":"...","size":4283}`
3. `POST /api/webui/commit`: atomically swaps staging into place. Staging must contain `/index.html.gz` (or `/index.html`), else `400`. Response: `{"ok":true,"webui":{...}}`

`POST /api/webui/reset` deletes the uploaded UI and falls back to the built-in one.

```bash
B=http://192.168.31.125
curl -X POST $B/api/webui/begin
curl -F "f=@web/index.html.gz" "$B/api/webui/upload?path=/index.html.gz"
curl -F "f=@web/assets/index-C2VtJ0GX.css.gz" "$B/api/webui/upload?path=/assets/index-C2VtJ0GX.css.gz"
curl -X POST $B/api/webui/commit
```

Errors: `503` `{"error":"filesystem not available (...)"}` when LittleFS is not mounted; `400` `{"ok":false,"error":"invalid path"}` / `"call POST /api/webui/begin first"` / `"write failed (storage full?)"`.

### `GET /api/history`

Temperature/humidity history stored in LittleFS (`/hist`).

- Every 10 minutes (on wall-clock boundaries: `xx:00`, `xx:10`, ...) one record is written with the **average** of the samples taken every 10 s during that interval. Its `ts` is the end of the interval, so the `06:00` record covers 05:50–06:00.
- `recent`: every record from the last 7 days.
- `archive`: records older than 7 days, one per period at **00:00 / 06:00 / 12:00 / 18:00** local time (the first record in that hour, normally the `:00` one; `:10`..`:50` if the device was off at `:00`). Kept for 2 years (2920 records); the oldest are dropped.
- No record is written while NTP time is not synced, or when the sensor has no reading for the whole interval.

Query: `part=recent|archive|all` (default `all`). Unknown values → `400`.

Each row is `[ts, temperatureC, humidity, relays]`:

- `ts`: Unix time in seconds (UTC); convert to local time in the client
- `temperatureC` / `humidity`: interval averages, 2 decimals
- `relays`: bit flags. bit0 dayHeat, bit1 nightHeat, bit2 uvb, bit3 relay4: set if that relay was on at any time during the interval. bit7: day mode when the record was written

Rows are in chronological order. The 7-day split uses the current time; if time is not synced it uses the newest record's time.

```json
{
  "timeSynced": true,
  "intervalSec": 600,
  "fields": ["ts", "temperatureC", "humidity", "relays"],
  "recent": [[1730340000, 30.42, 61.15, 133], [1730340600, 30.51, 60.98, 132]],
  "archive": [[1729720800, 26.80, 65.02, 2], [1729742400, 30.12, 58.40, 133]]
}
```

The response is sent with chunked transfer encoding (up to ~80 KB for a full `all`), not as one buffer. Errors: `503` when LittleFS is not mounted.

### `POST /api/history/clear`

Deletes all history. Response: `{"ok":true,"history":{"recording":true,"recentCount":0,"archiveCount":0}}`

## Serving the Web UI

For each request path, the device looks up:

1. the uploaded UI in LittleFS: `/` → `/www/index.html(.gz)`, otherwise `/www<path>(.gz)`; used only when an uploaded `index.html(.gz)` exists
2. the built-in assets compiled from `web_assets.gz.h`

`.gz` files are sent as-is with `Content-Encoding: gzip`; MIME is inferred from the request path extension. HTML is sent with `Cache-Control: no-cache` (so an upload takes effect on reload) and other assets with `max-age=86400`.

## Uploads and the control loop

An upload is processed synchronously inside `server.handleClient()`, so `loop()` pauses for the duration of the transfer (a few seconds on a LAN). To keep heating safe, the upload callbacks call the temperature sampling/control routine on every received chunk.

## Default Configuration

Default mode rules (after `POST /api/config/reset`):

```json
{
  "dayStart": "08:00",
  "nightStart": "20:00",
  "dayMinTemp": 30.0,
  "dayMaxTemp": 32.0,
  "dayHeatRole": 2,
  "dayNightHeatRole": 0,
  "dayUvbRole": 1,
  "dayReservedRole": 0,
  "nightMinTemp": 26.0,
  "nightMaxTemp": 28.0,
  "nightHeatRole": 0,
  "nightNightHeatRole": 2,
  "nightUvbRole": 0,
  "nightReservedRole": 0
}
```

In plain terms, the default behaves as: day mode heats with the heat relay and keeps UVB on; night mode heats with the nightHeat relay and turns everything else off; the reserved relay is always off.

## Notes

- WiFi: if no SSID is stored, or the station has been disconnected for 60 s, the device opens the config AP (`SunBox-XXXX`, password `sunbox123`) while it keeps retrying the station in the background (every 30 s, paused while a phone is connected to the AP). Once the station connects, the AP stays up for another 60 s so the setup page can show the new IP, then shuts down.
- The device uses NTP after WiFi connection to determine day/night mode.
- If time is not yet available, firmware currently falls back to `day` mode.
- If the AHT20 sensor is unavailable, heating relays are turned off.
- Flash layout comes from `partitions.csv` in the sketch folder: two 1.75 MB OTA app slots + 384 KB LittleFS (uploaded web UI and history). Changing it requires a USB flash.
- Relay outputs are configured for an active-low relay module.

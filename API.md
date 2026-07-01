# SunBox API Documentation

## Overview

SunBox exposes a small HTTP API for status queries and configuration updates.

- Base protocol: `HTTP`
- Default port: `80`
- Response format: `application/json`
- Device role: temperature control system for day/night modes

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

Returns a simple API description.

#### Response Example

```json
{
  "name": "SunBox",
  "message": "Use /api/status, /api/config, /api/config/reset",
  "configPostFormat": "JSON or form fields"
}
```

### `GET /api/status`

Returns current runtime status, sensor state, relay state, pins, and active config.

#### Response Fields

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

#### Response Example

```json
{
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
  }
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

- The device uses NTP after WiFi connection to determine day/night mode.
- If time is not yet available, firmware currently falls back to `day` mode.
- If the AHT20 sensor is unavailable, heating relays are turned off.
- Relay outputs are configured for an active-low relay module.

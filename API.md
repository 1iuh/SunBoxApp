# SunBox API Documentation

## Overview

SunBox exposes a small HTTP API for status queries and configuration updates.

- Base protocol: `HTTP`
- Default port: `80`
- Response format: `application/json`
- Device role: temperature control system for day/night modes

## Hardware Mapping

- AHT20 I2C SDA: `IO0`
- AHT20 I2C SCL: `IO1`
- Relay 1 Day Heat: `IO3`
- Relay 2 Night Heat: `IO4`
- Relay 3 Day UVB: `IO5`
- Relay 4 Reserved: `IO7`

## Control Logic

- `day` mode uses the configured day time range.
- `night` mode uses the configured night time range.
- In `day` mode:
  - Relay 1 controls the day heating lamp.
  - Relay 3 controls the UVB lamp.
- In `night` mode:
  - Relay 2 controls the night heating lamp.
  - Relay 3 is turned off.
- Relay 4 is reserved and currently not used by control logic.

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
- `pins`: current pin mapping
- `relays`: current relay output state
- `config`: current active configuration

#### Response Example

```json
{
  "mode": "day",
  "temperatureC": 30.42,
  "humidity": 61.15,
  "wifiConnected": true,
  "timeSynced": true,
  "sensorReady": true,
  "pins": {
    "i2cSda": 0,
    "i2cScl": 1,
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
  "config": {
    "dayStart": "08:00",
    "nightStart": "20:00",
    "dayMinTemp": 30.0,
    "dayMaxTemp": 32.0,
    "nightMinTemp": 26.0,
    "nightMaxTemp": 28.0
  }
}
```

### `GET /api/config`

Returns the persisted configuration currently used by the device.

#### Response Example

```json
{
  "dayStart": "08:00",
  "nightStart": "20:00",
  "dayMinTemp": 30.0,
  "dayMaxTemp": 32.0,
  "nightMinTemp": 26.0,
  "nightMaxTemp": 28.0
}
```

### `POST /api/config`

Updates the day/night schedule and temperature thresholds.

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
  "nightMinTemp": 26.0,
  "nightMaxTemp": 28.0
}
```

#### Form Request Example

```text
dayStart=08:00&nightStart=20:00&dayMinTemp=30.0&dayMaxTemp=32.0&nightMinTemp=26.0&nightMaxTemp=28.0
```

#### Request Fields

- `dayStart`: day mode start time, format `HH:MM`
- `nightStart`: night mode start time, format `HH:MM`
- `dayMinTemp`: minimum temperature for day mode
- `dayMaxTemp`: maximum temperature for day mode
- `nightMinTemp`: minimum temperature for night mode
- `nightMaxTemp`: maximum temperature for night mode

#### Validation Rules

- `dayStart` and `nightStart` must use `HH:MM`
- hours must be `00` to `23`
- minutes must be `00` to `59`
- `dayMinTemp <= dayMaxTemp`
- `nightMinTemp <= nightMaxTemp`

#### Success Response Example

```json
{
  "ok": true,
  "config": {
    "dayStart": "08:00",
    "nightStart": "20:00",
    "dayMinTemp": 30.0,
    "dayMaxTemp": 32.0,
    "nightMinTemp": 26.0,
    "nightMaxTemp": 28.0
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

Invalid configuration:

```json
{
  "error": "invalid configuration"
}
```

### `POST /api/config/reset`

Resets configuration to firmware defaults and immediately applies it.

#### Success Response Example

```json
{
  "ok": true,
  "message": "config reset to default"
}
```

## Default Configuration

```json
{
  "dayStart": "08:00",
  "nightStart": "20:00",
  "dayMinTemp": 30.0,
  "dayMaxTemp": 32.0,
  "nightMinTemp": 26.0,
  "nightMaxTemp": 28.0
}
```

## Notes

- The device uses NTP after WiFi connection to determine day/night mode.
- If time is not yet available, firmware currently falls back to `day` mode.
- If the AHT20 sensor is unavailable, heating relays are turned off.
- Relay outputs are configured for an active-low relay module.

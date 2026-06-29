# SunBox App

一个面向手机浏览器的局域网控制面板，适合部署为静态 WebApp，并直接访问同一局域网内的 `ESP32`。

## 技术架构

- `Vue 3`
- `Vite`
- 纯静态前端
- 局域网静态托管
- 前端直连 `ESP32`

这套方案的目标是：

- 不依赖 Android Studio
- 不需要把 HTML/CSS/JS 放进 ESP32
- 开发和更新都尽量轻
- 后面可继续扩展成多页面控制台

## 本地开发

先安装 Node.js 20 或更高版本，然后执行：

```bash
npm install
npm run dev
```

开发服务默认监听：

- `http://localhost:5173`
- 局域网访问可用：`http://你的电脑IP:5173`

## 生产构建

```bash
npm run build
```

生成的静态文件在 `dist/` 目录。你可以把它部署到：

- NAS 静态目录
- 路由器静态目录
- 家里常开的旧电脑
- 任意轻量 Web 服务器

推荐用局域网内 `http` 地址访问前端，再请求局域网里的 `ESP32`，这样可以避开公网 `https` 页面访问内网 `http` 设备时常见的混合内容限制。

## ESP32 对接约定

当前前端默认请求：

- `GET /api/status`
- `GET /api/config`
- `POST /api/config`
- `POST /api/config/reset`

默认设备地址：

- `http://192.168.4.1`

你可以在首页手动修改设备地址，前端会保存到浏览器本地存储。

## Mock 模式

为了在暂时无法联调设备时先看 UI，首页增加了一个 `Mock 模式` 开关。

- 打开后：同步、保存配置、恢复默认都走前端内置演示数据
- 关闭后：恢复直连真实 `ESP32`

Mock 配置同样会保存在浏览器本地存储里，方便你反复调整页面效果。

当前状态接口会读取 `GET /api/status`，结构示例：

```json
{
  "mode": "day",
  "temperatureC": 30.42,
  "humidity": 61,
  "wifiConnected": true,
  "timeSynced": true,
  "sensorReady": true,
  "relays": {
    "dayHeat": false,
    "nightHeat": false,
    "uvb": true
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

保存配置时前端会提交：

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

如果你的接口字段后面有调整，改 [src/lib/esp32.js](/C:/Projects/SunBoxApp/src/lib/esp32.js) 和 [src/App.vue](/C:/Projects/SunBoxApp/src/App.vue) 就可以。

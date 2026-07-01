<div align="center">

# ☀️ SunBox

**面向爬宠箱的智能温控面板** · Vue 3 + Vite 纯静态前端，直连 ESP32

[快速开始](#快速开始) · [ESP32 对接](#esp32-对接约定) · [项目结构](#项目结构)

</div>

---

SunBox 是一个为爬宠（蜥蜴、守宫等）饲养箱设计的轻量温控 Web 面板。它以**纯静态站点**的形式部署，通过 HTTP 直接与同一局域网内的 ESP32 固件通信，实现日/夜双模式温控、继电器角色配置、GPIO 引脚映射和实时状态监控。

- 🌗 **日/夜双模式**：独立的时间窗口、温度阈值与每路继电器角色
- 🌡️ **实时温度表盘**：CSS 绘制的弧形仪表，直观展示当前温度与目标区间
- 🔌 **四路继电器控制**：加温灯、UVB 灯、夜间加温、备用继电器，逐路配置角色（常亮 / 常闭 / 滞回加温）
- 📌 **GPIO 引脚映射**：在面板上直接配置继电器到 GPIO 的对应关系
- 💾 **自动保存**：调整日间/夜间参数后自动防抖提交到设备，无需手动点保存
- 📱 **PWA 就绪**：可"添加到主屏幕"，像原生 App 一样全屏运行
- 📦 **构建预压缩**：`npm run build` 同时输出 `.gz`，传输体积直降 60%+

## 技术栈

| | |
| --- | --- |
| **框架** | [Vue 3](https://vuejs.org/) `<script setup>` + 响应式状态 |
| **构建** | [Vite 6](https://vitejs.dev/) · 生产构建预压缩 gzip |
| **样式** | 原生 CSS（CSS 变量 + conic-gradient 表盘） |
| **运行时** | 零额外运行时依赖，仅 `vue` 一个生产依赖 |
| **PWA** | Web App Manifest + 可安装 |

## 快速开始

### 环境要求

- Node.js ≥ 20
- 一台同局域网的 ESP32 固件（实现下方约定的 HTTP API）

### 本地开发

```bash
npm install
npm run dev
```

开发服务默认监听 `http://localhost:5173`，局域网内设备可用 `http://你的电脑IP:5173` 访问。

### 生产构建

```bash
npm run build
```

产物输出到 `dist/`：

```
dist/
├── index.html           (+ index.html.gz)
├── manifest.webmanifest
├── icon.svg, icon-maskable.svg
└── assets/
    ├── index-xxxx.css   (+ .css.gz)
    └── index-xxxx.js    (+ .js.gz)
```

> 默认启用 gzip 预压缩（`vite-plugin-compression`），原文件保留。若你的静态服务器支持发送预压缩内容，传输体积可从 ~108 kB 降至 ~37 kB。

把 `dist/` 部署到任意静态服务器（NAS、路由器、ESP32 本机的 LittleFS 等）即可。

## ESP32 对接约定

### 默认地址

**默认使用与页面相同的域（同源）**。当面板与 ESP32 固件由同一台 HTTP 服务托管时（例如直接刷进 ESP32 的 LittleFS），无需任何配置即可工作。

若面板部署在其他主机，可在「系统」标签页填入 ESP32 地址（如 `http://192.168.31.125`），设置会写入 Cookie。

> ⚠️ 推荐用 `http` 访问面板，避免公网 `https` 页面请求内网 `http` 设备时触发的混合内容限制。

### HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/status` | 实时状态：模式、温湿度、Wi-Fi/NTP、继电器状态、引脚映射、当前规则 |
| `GET` | `/api/rules` | 读取持久化的日/夜模式规则 |
| `POST` | `/api/rules` | 更新全部模式规则（立即生效，持久化到 NVS） |
| `POST` | `/api/config/reset` | 恢复固件默认规则 |
| `POST` | `/api/power` | 全局电源开关（关闭后所有继电器锁定） |
| `POST` | `/api/relays` | 手动切换单路继电器（60 秒手动覆盖） |
| `GET` | `/api/pins` | 读取继电器到 GPIO 的映射 |
| `POST` | `/api/pins` | 更新引脚映射 |

完整字段定义见 [API.md](./API.md)。

### 继电器角色

每路继电器在每个模式下都可配置独立角色：

| 角色值 | 名称 | 行为 |
| --- | --- | --- |
| `0` | `off` | 常闭 |
| `1` | `on` | 常亮 |
| `2` | `heat` | 滞回加温：低于 `minTemp` 开启，高于 `maxTemp` 关闭，区间内保持 |

**控制优先级**（高→低）：全局电源关 → 手动继电器覆盖（60s）→ 自动模式规则。

## 项目结构

```
SunBoxApp/
├── index.html              # HTML 入口（PWA meta）
├── vite.config.js          # Vite 配置 + gzip 预压缩
├── API.md                  # ESP32 HTTP API 完整文档
├── public/
│   ├── manifest.webmanifest
│   ├── icon.svg
│   └── icon-maskable.svg
└── src/
    ├── main.js             # 应用入口
    ├── App.vue             # 主面板（4 个标签页 + 状态管理）
    ├── style.css           # 全局样式与表盘
    └── lib/
        └── esp32.js        # ESP32 HTTP API 封装（fetch）
```

## 工作原理

```
┌─────────────┐   HTTP (同局域网)   ┌──────────┐   GPIO    ┌────────────┐
│  手机浏览器   │ ─────────────────▶ │  ESP32   │ ────────▶ │ 加温灯/UVB  │
│  SunBox PWA  │ ◀───────────────── │  固件    │           │ 继电器组    │
└─────────────┘    JSON 状态/规则    └──────────┘           └────────────┘
```

面板每 10 秒自动轮询 `/api/status` 刷新表盘；调整参数后防抖 700ms 自动 `POST /api/rules`，无需手动保存。

## 开发说明

- 接口字段如有调整，主要修改 [`src/lib/esp32.js`](./src/lib/esp32.js) 与 [`src/App.vue`](./src/App.vue)
- 表盘几何、双滑块约束等纯计算函数集中在 `App.vue` 的 `<script setup>` 中，无副作用，便于测试

## License

MIT

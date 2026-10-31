import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import viteCompression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    vue(),
    // 构建时预压缩为 .gz（保留原文件），供支持 gzip 的静态服务器直接发送预压缩内容。
    // 每个文件都要有 .gz：SunBox 固件只托管/上传 *.gz（含图标与 manifest），缺了就是 404。
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 0,
      filter: /\.(js|mjs|json|css|html|svg|webmanifest)$/i,
      deleteOriginFile: false
    })
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 网页只用同源请求。本地调试时把设备接口转发到真实设备：
    //   SUNBOX_DEVICE=http://192.168.31.125 npm run dev
    proxy: process.env.SUNBOX_DEVICE
      ? Object.fromEntries(
          ['/api', '/update', '/wifi'].map((path) => [path, { target: process.env.SUNBOX_DEVICE, changeOrigin: true }])
        )
      : undefined
  },
  preview: {
    host: '0.0.0.0',
    port: 4173
  }
})

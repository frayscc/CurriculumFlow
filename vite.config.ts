import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'CurriculumFlow · 备课组教学计划与资源管理',
      short_name: 'CurriculumFlow',
      description: '离线管理教学计划、执行记录和考试资源',
      lang: 'zh-CN',
      start_url: '/', scope: '/', display: 'standalone', background_color: '#f5f4f0', theme_color: '#1c2630',
      icons: [
        { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'], maximumFileSizeToCacheInBytes: 2 * 1024 * 1024 },
  })],
  test: { environment: 'node' },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // 后端 API 起来之后（task #7），这里会把 /api 请求转发过去。现在还没有后端，
      // 前端先用 mock 数据渲染，等 UI 定稿再接。
      '/api': 'http://localhost:8787',
    },
  },
});

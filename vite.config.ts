import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // 相对路径 base，兼容 GitHub Pages 项目页（https://<user>.github.io/<repo>/）子路径部署
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
});

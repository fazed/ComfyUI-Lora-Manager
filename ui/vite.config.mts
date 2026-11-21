import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// Backend that `bun run dev` proxies API and media requests to.
const BACKEND = process.env.LM_BACKEND ?? 'http://127.0.0.1:8188'

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  // Production build uses a relative base: the backend injects a relative
  // <base href> into index.html (py/routes/modern_ui_routes.py), so the same
  // committed dist works at /lm-ui/ behind any reverse-proxy prefix.
  // The dev server mirrors the production mount path.
  base: command === 'build' ? './' : '/lm-ui/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/loras_static': { target: BACKEND, changeOrigin: true },
      '/example_images_static': { target: BACKEND, changeOrigin: true },
      '/lm-ui/user-themes': { target: BACKEND, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 300,
  },
}))

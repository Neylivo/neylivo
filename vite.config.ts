import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

// base './' so built asset paths are relative — required for Electron file:// loading
export default defineConfig({
  base: './',
  plugins: [react()],
  // v1.59.0: версия приложения из package.json — показывается в правом нижнем углу
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})

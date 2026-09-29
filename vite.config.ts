import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { ldtBridge } from './bridge/vite-plugin-ldt.ts'

export default defineConfig({
  plugins: [react(), tailwindcss(), ldtBridge()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
})

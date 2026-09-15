import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // qrcode hanya dipakai di halaman builder (dynamic import) — pisah chunk
  // supaya bundle utama panel tidak membawa ~40KB encoder QR.
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/qrcode') || id.includes('node_modules/dijkstrajs')) return 'qrcode';
        },
      },
    },
  },
  server: {
    proxy: { '/api/v1': 'http://localhost:8791' },
  },
})

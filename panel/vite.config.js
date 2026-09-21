import { execFileSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

let commit = process.env.GITHUB_SHA?.slice(0, 7);
if (!commit) { try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim(); } catch { commit = 'dev'; } }
const release = { version: process.env.GITHUB_RUN_NUMBER ? `1.0.${process.env.GITHUB_RUN_NUMBER}` : '1.0', commit, deployment: process.env.GITHUB_RUN_NUMBER ? `${process.env.GITHUB_RUN_NUMBER}.${process.env.GITHUB_RUN_ATTEMPT || '1'}` : null, builtAt: new Date().toISOString() };

export default defineConfig({
  define: { __APP_RELEASE__: JSON.stringify(release) },
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

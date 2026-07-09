import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production is served from the /running-base/ GitHub Pages path; the dev
// server stays root-relative so local preview reaches it at /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/running-base/',
  // Honor a harness-assigned PORT (autoPort) so the dev server binds to the
  // expected port instead of falling back to Vite's default 5173→5174. No PORT
  // set (plain `npm run dev`) → Vite's default behavior, unchanged.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
}))

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Production is served from the /running-base/ GitHub Pages path; the dev
// server stays root-relative so local preview reaches it at /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/running-base/',
}))

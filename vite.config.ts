import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
// Importing from 'vitest/config' also augments vite's UserConfig with `test`.
import { configDefaults } from 'vitest/config'

// Production is served from the /running-base/ GitHub Pages path; the dev
// server stays root-relative so local preview reaches it at /.
export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    // Offline app shell: precache the built HTML/JS/CSS/icons so the app opens
    // with no network (training data was already offline-safe in localStorage;
    // this closes the cold-start gap). Build-only — no SW in dev. The existing
    // public/manifest.json stays the canonical manifest (manifest: false), so
    // install metadata is unchanged; the plugin only generates + registers the
    // service worker. autoUpdate: a new deploy is fetched in the background and
    // activates on the next visit — no user prompt, no stale-forever cache.
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json}'],
        // SPA offline navigation: unknown URLs under the app scope fall back
        // to the precached index.html (served under the /running-base/ base).
        navigateFallback: 'index.html',
      },
    }),
  ],
  // Dev stays root-relative; build AND `vite preview` (command 'serve' but
  // mode 'production') use the real /running-base/ base so the preview serves
  // the exact production layout — required to verify the service worker.
  base: command === 'serve' && mode === 'development' ? '/' : '/running-base/',
  // Honor a harness-assigned PORT (autoPort) so the dev server binds to the
  // expected port instead of falling back to Vite's default 5173→5174. No PORT
  // set (plain `npm run dev`) → Vite's default behavior, unchanged.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : undefined,
  test: {
    // Historical phase worktrees under .claude/worktrees carry stale copies of
    // the suites — exclude them so the reported count reflects the real tree.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
  },
}))

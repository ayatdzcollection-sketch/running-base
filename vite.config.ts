import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Importing from 'vitest/config' also augments vite's UserConfig with `test`.
import { configDefaults } from 'vitest/config'

// Production is served from the /running-base/ GitHub Pages path; the dev
// server stays root-relative so local preview reaches it at /.
export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'serve' ? '/' : '/running-base/',
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

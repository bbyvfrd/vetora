/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Source maps are uploaded to Sentry from CI only (SENTRY_AUTH_TOKEN set) and removed from the build.
const sentryUpload = process.env.SENTRY_AUTH_TOKEN
  ? [
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      }),
    ]
  : []

// The dev ports come from the checkout's root .env, written by `pnpm local:setup` (one slot per worktree, AGENTS.md
// "Worktrees"): the main checkout keeps 5173 and 3000, a worktree gets its own pair. strictPort fails on a taken
// port instead of drifting to the next one, which the API's PUBLIC_ORIGIN would not match.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, 'VETORA_')
  const webPort = Number(env.VETORA_WEB_PORT ?? 5173)
  const apiPort = Number(env.VETORA_API_PORT ?? 3000)
  return {
    plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), ...sentryUpload],
    server: {
      port: webPort,
      strictPort: true,
      // One origin: in production kamal-proxy routes /api to the API container; locally Vite does.
      proxy: { '/api': `http://localhost:${apiPort}` },
    },
    build: { sourcemap: 'hidden' },
    test: {
      // The DOM tests (spec #9, seam 1): a page rendered in jsdom with Testing Library; src/test-setup.ts adds jest-dom's
      // matchers and the cleanup after each test.
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})

import { sentryVitePlugin } from '@sentry/vite-plugin'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Source maps are uploaded to Sentry from CI only (SENTRY_AUTH_TOKEN set) and removed from the build.
const sentryUpload = process.env['SENTRY_AUTH_TOKEN']
  ? [
      sentryVitePlugin({
        org: process.env['SENTRY_ORG'],
        project: process.env['SENTRY_PROJECT'],
        authToken: process.env['SENTRY_AUTH_TOKEN'],
        sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
      }),
    ]
  : []

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), ...sentryUpload],
  server: {
    port: 5173,
    // One origin: in production kamal-proxy routes /api to the API container; locally Vite does.
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { sourcemap: 'hidden' },
})

import { defineConfig } from 'vitest/config'

// The API's tests import the app, whose request logger would otherwise print a line per request.
export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' },
  },
})

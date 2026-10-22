import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The API's tests import the app, whose request logger would otherwise print a line per request.
// The workspace .env (when present) supplies DATABASE_URL_MIGRATOR and DATABASE_URL_DIRECT, which turn the
// database tests on; shell variables win over the file (CI sets them without a .env). Those tests run against
// vetora_test, emptied by the global setup before the run (src/platform/db/test-support.ts).
try {
  process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)))
} catch {
  // No .env here: the database tests are skipped unless the shell provides the variables.
}

export default defineConfig({
  test: {
    env: { LOG_LEVEL: 'silent' },
    globalSetup: ['./src/platform/db/test-support.ts'],
    // The database test files share vetora_test, and the migrator tests empty it before each case, so the files run
    // one after another; within a file the cases are sequential anyway.
    fileParallelism: false,
  },
})

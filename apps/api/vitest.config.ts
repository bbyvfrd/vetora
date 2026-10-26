import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The API's tests import the app, whose request logger would otherwise print a line per request.
// The workspace .env (when present) supplies DATABASE_URL_MIGRATOR and DATABASE_URL_DIRECT, which turn the
// database tests on; shell variables win over the file (CI sets them without a .env). Those tests run against
// vetora_test, emptied by the global setup before the run (src/platform/db/test-database.ts).
try {
  process.loadEnvFile(fileURLToPath(new URL('.env', import.meta.url)))
} catch {
  // No .env here: the database tests are skipped unless the shell provides the variables.
}

/**
 * The app's own pool (db(), and Better Auth behind it) on vetora_test, as test-database.ts derives the app URL: the
 * API seam's requests and the logins test practices get never reach vetora. Unset when the database tests are off.
 */
function testPooledUrl(): string | undefined {
  const direct = process.env.DATABASE_URL_DIRECT
  if (!direct) return undefined
  const url = new URL(direct)
  url.pathname = '/vetora_test'
  return url.toString()
}
const pooled = testPooledUrl()

export default defineConfig({
  test: {
    env: {
      LOG_LEVEL: 'silent',
      // The API's configuration as the tests run it (src/platform/config.ts): the origin the web app is served from
      // locally, and a signing secret used nowhere else.
      PUBLIC_ORIGIN: 'http://localhost:5173',
      BETTER_AUTH_SECRET: 'vitest-only-secret-never-used-outside-the-tests',
      ...(pooled ? { DATABASE_URL_POOLED: pooled } : {}),
    },
    globalSetup: ['./src/platform/db/test-database.ts'],
    // Each file closes the app's pools when it is done (src/platform/db/test-setup.ts).
    setupFiles: ['./src/platform/db/test-setup.ts'],
    // The database test files share vetora_test, and the migrator tests empty it before each case, so the files run
    // one after another; within a file the cases are sequential anyway.
    fileParallelism: false,
  },
})

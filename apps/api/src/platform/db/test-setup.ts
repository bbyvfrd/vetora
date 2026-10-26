import { afterAll } from 'vitest'
import { closeDatabase } from './index.js'

// Vitest setupFiles entry for the API project: a test file that reached the app's pools (a request through app.request,
// a test practice's logins through Better Auth) closes them when it ends, so no connection outlives the file. A file
// that never touched them closes nothing. Left out of dist/ by tsconfig.build.json.
afterAll(() => closeDatabase())

import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
import { cleanup } from '@testing-library/react'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach } from 'vitest'
import { draftsSettled } from './drafts'

// jsdom's scrollTo only reports "not implemented", and the router calls it after a navigation.
window.scrollTo = () => {}

// jsdom has no IndexedDB: an in memory one (spec #18, seam 3, with its IDBKeyRange and the rest), empty for each test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory()
})

// Testing Library unmounts by itself only when Vitest's globals are on; they are off here. A page left keeps its
// last text on the way out, which lands before the next test's empty IndexedDB.
afterEach(async () => {
  cleanup()
  await draftsSettled()
})

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// jsdom's scrollTo only reports "not implemented", and the router calls it after a navigation.
window.scrollTo = () => {}

// Testing Library unmounts by itself only when Vitest's globals are on; they are off here.
afterEach(() => cleanup())

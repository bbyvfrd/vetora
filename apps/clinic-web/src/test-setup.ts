import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library unmounts by itself only when Vitest's globals are on; they are off here.
afterEach(() => cleanup())

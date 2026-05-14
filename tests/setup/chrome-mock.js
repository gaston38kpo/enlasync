import { vi } from 'vitest'
import { chrome } from 'jest-chrome/lib/index.esm.js'

globalThis.jest = vi
globalThis.chrome = chrome

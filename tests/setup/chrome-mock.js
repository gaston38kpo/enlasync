import { vi } from 'vitest'
import { chrome } from 'jest-chrome/lib/index.esm.js'

globalThis.jest = vi

chrome.offscreen = {
  hasDocument: vi.fn().mockResolvedValue(true),
  createDocument: vi.fn().mockResolvedValue(undefined),
}

globalThis.chrome = chrome

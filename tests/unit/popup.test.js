import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveSyncKeys } from '@/popup/App.jsx'

describe('saveSyncKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chrome.storage.local.set = vi.fn().mockResolvedValue(undefined)
    chrome.runtime.reload = vi.fn()
  })

  it('saves normalized sync_keys to storage and reloads runtime', async () => {
    await saveSyncKeys(['key-a', 'key-b'])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
    expect(chrome.runtime.reload).toHaveBeenCalled()
  })

  it('deduplicates keys before saving', async () => {
    await saveSyncKeys(['key-a', 'key-b', 'key-a'])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
  })

  it('trims whitespace before saving', async () => {
    await saveSyncKeys(['  key-a  ', ' key-b'])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
  })

  it('removes empty strings before saving', async () => {
    await saveSyncKeys(['key-a', '', 'key-b', '  '])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
  })
})
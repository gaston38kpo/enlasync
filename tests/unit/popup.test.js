import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveSyncKey } from '@/popup/App.jsx'

describe('popup App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chrome.storage.local.set = vi.fn().mockResolvedValue(undefined)
    chrome.runtime.reload = vi.fn()
  })

  it('saves sync_key to storage and reloads runtime when user saves sync key', async () => {
    await saveSyncKey('my-key')

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_key: 'my-key' })
    expect(chrome.runtime.reload).toHaveBeenCalled()
  })
})

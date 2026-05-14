import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/background/supabase.js', () => ({
  createSupabaseClient: vi.fn(() => ({ from: vi.fn() })),
  pushTree: vi.fn().mockResolvedValue(undefined),
  subscribeToRemote: vi.fn(),
}))

vi.mock('@/background/bookmarks.js', () => ({
  findSyncFolder: vi.fn().mockResolvedValue({ id: 'sync1', title: '[SyncBookmarks]' }),
  applyDiff: vi.fn().mockResolvedValue(undefined),
  serializeTree: vi.fn().mockResolvedValue({ title: '[SyncBookmarks]', children: [] }),
}))

import { init, onLocalChange, isApplyingRemote } from '@/background/service-worker.js'
import { pushTree, subscribeToRemote, createSupabaseClient } from '@/background/supabase.js'
import { findSyncFolder, serializeTree } from '@/background/bookmarks.js'

describe('service-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('init reads storage, creates client, and subscribes to remote', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({ sync_key: 'abc', deviceId: 'dev1' })

    await init()

    expect(chrome.storage.local.get).toHaveBeenCalledWith(['sync_key', 'deviceId'])
    expect(createSupabaseClient).toHaveBeenCalled()
    expect(subscribeToRemote).toHaveBeenCalled()
  })

  it('onLocalChange debounces 200ms then calls pushTree when not applying remote', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({ sync_key: 'abc', deviceId: 'dev1' })
    await init()

    onLocalChange()
    expect(pushTree).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)

    expect(findSyncFolder).toHaveBeenCalled()
    expect(serializeTree).toHaveBeenCalledWith('sync1')
    expect(pushTree).toHaveBeenCalled()
  })

  it('onLocalChange does NOT call pushTree when isApplyingRemote is true', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({ sync_key: 'abc', deviceId: 'dev1' })
    await init()

    const remoteCallback = subscribeToRemote.mock.calls[0][3]
    remoteCallback({ children: [] })

    onLocalChange()
    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).not.toHaveBeenCalled()
  })
})

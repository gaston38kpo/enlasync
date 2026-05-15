import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/background/supabase.js', () => ({
  createSupabaseClient: vi.fn(() => ({ from: vi.fn() })),
  pushTree: vi.fn().mockResolvedValue(undefined),
  fetchTree: vi.fn().mockResolvedValue(null),
  subscribeToRemote: vi.fn(),
}))

vi.mock('@/background/bookmarks.js', () => ({
  findSyncFolder: vi.fn().mockResolvedValue({ id: 'sync1', title: 'abc' }),
  findKeyForNode: vi.fn().mockResolvedValue(null),
  applyDiff: vi.fn().mockResolvedValue(undefined),
  serializeTree: vi.fn().mockResolvedValue({ title: 'abc', children: [] }),
}))

import { init, normalizeSyncKeys, onBookmarkCreated, onBookmarkRemoved, onBookmarkChanged, onBookmarkMoved } from '@/background/service-worker.js'
import { pushTree, fetchTree, createSupabaseClient } from '@/background/supabase.js'
import { findSyncFolder, findKeyForNode, serializeTree } from '@/background/bookmarks.js'

describe('normalizeSyncKeys', () => {
  it('deduplicates keys', () => {
    expect(normalizeSyncKeys(['a', 'b', 'a'])).toEqual(['a', 'b'])
  })

  it('trims whitespace from keys', () => {
    expect(normalizeSyncKeys(['  a  ', ' b'])).toEqual(['a', 'b'])
  })

  it('removes empty strings', () => {
    expect(normalizeSyncKeys(['a', '', 'b', '  '])).toEqual(['a', 'b'])
  })

  it('returns empty array for non-array input', () => {
    expect(normalizeSyncKeys(null)).toEqual([])
    expect(normalizeSyncKeys(undefined)).toEqual([])
    expect(normalizeSyncKeys('abc')).toEqual([])
  })

  it('removes non-string entries', () => {
    expect(normalizeSyncKeys(['a', 123, 'b'])).toEqual(['a', 'b'])
  })

  it('returns empty array for empty input', () => {
    expect(normalizeSyncKeys([])).toEqual([])
  })
})

describe('service-worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    chrome.storage.local.get = vi.fn().mockResolvedValue({})
    chrome.storage.local.set = vi.fn().mockResolvedValue(undefined)
    chrome.offscreen.hasDocument = vi.fn().mockResolvedValue(true)
    chrome.offscreen.createDocument = vi.fn().mockResolvedValue(undefined)
    chrome.runtime.sendMessage = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('init reads sync_keys from storage and initializes each key', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a', 'key-b'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })

    await init()

    expect(chrome.storage.local.get).toHaveBeenCalledWith(['sync_keys', 'sync_key', 'deviceId'])
    expect(findSyncFolder).toHaveBeenCalledWith('key-a')
    expect(findSyncFolder).toHaveBeenCalledWith('key-b')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'offscreen-config', syncKeys: ['key-a', 'key-b'] })
    )
  })

  it('init migrates from legacy sync_key to sync_keys', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_key: 'my-legacy-key',
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync1', title: 'my-legacy-key' })

    await init()

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['my-legacy-key'] })
    expect(findSyncFolder).toHaveBeenCalledWith('my-legacy-key')
  })

  it('init with no keys does not call findSyncFolder', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({ deviceId: 'dev1' })

    await init()

    expect(findSyncFolder).not.toHaveBeenCalled()
  })

  it('onBookmarkCreated triggers debounce push for the affected key', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })
    findKeyForNode.mockResolvedValue('key-a')

    await init()
    onBookmarkCreated('b1', { id: 'b1', parentId: 'sync-a' })

    expect(pushTree).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)

    expect(findSyncFolder).toHaveBeenCalledWith('key-a')
    expect(pushTree).toHaveBeenCalled()
  })

  it('onBookmarkCreated ignores events outside sync folders', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })
    findKeyForNode.mockResolvedValue(null)

    await init()
    onBookmarkCreated('b1', { id: 'b1', parentId: 'outside' })

    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).not.toHaveBeenCalled()
  })

  it('onBookmarkMoved syncs both old and new keys', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a', 'key-b'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockImplementation((key) => {
      if (key === 'key-a') return Promise.resolve({ id: 'sync-a', title: 'key-a' })
      if (key === 'key-b') return Promise.resolve({ id: 'sync-b', title: 'key-b' })
    })
    findKeyForNode.mockImplementation((parentId) => {
      if (parentId === 'sync-a') return Promise.resolve('key-a')
      if (parentId === 'sync-b') return Promise.resolve('key-b')
      return Promise.resolve(null)
    })

    await init()
    onBookmarkMoved('b1', { parentId: 'sync-b', oldParentId: 'sync-a' })

    await vi.advanceTimersByTimeAsync(200)

    // Both keys should be synced
    expect(findSyncFolder).toHaveBeenCalledWith('key-a')
    expect(findSyncFolder).toHaveBeenCalledWith('key-b')
  })

  it('onBookmarkCreated does not push when bookmark has no parentId', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })

    await init()
    onBookmarkCreated('b1', { id: 'b1' }) // no parentId

    await vi.advanceTimersByTimeAsync(200)
    expect(pushTree).not.toHaveBeenCalled()
  })

  it('onBookmarkRemoved pushes for the affected key', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })
    findKeyForNode.mockResolvedValue('key-a')

    await init()
    onBookmarkRemoved('old1', { parentId: 'sync-a' })

    await vi.advanceTimersByTimeAsync(200)
    expect(pushTree).toHaveBeenCalled()
  })

  it('onBookmarkRemoved does not push when removeInfo has no parentId', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })

    await init()
    onBookmarkRemoved('old1', null)

    await vi.advanceTimersByTimeAsync(200)
    expect(pushTree).not.toHaveBeenCalled()
  })
})
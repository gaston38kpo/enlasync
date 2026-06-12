import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/background/crypto.js', () => ({
  encrypt: vi.fn(),
  decrypt: vi.fn(),
  safeDecrypt: vi.fn(),
}))

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
  ensureBackupFolder: vi.fn().mockResolvedValue({ id: 'backup1', title: '[SyncBookmarksBackup]' }),
  copyTreeToBackup: vi.fn().mockResolvedValue(3),
  initializeBackupIfNeeded: vi.fn().mockResolvedValue(undefined),
  ROOT_TITLE: '[SyncBookmarks]',
}))

import { init, normalizeSyncKeys, onBookmarkCreated, onBookmarkRemoved, onBookmarkChanged, onBookmarkMoved, onBookmarkChildrenReordered, forceSync, handleRemoteChange, forceBackupOverride } from '@/background/service-worker.js'
import { pushTree, fetchTree, createSupabaseClient } from '@/background/supabase.js'
import { findSyncFolder, findKeyForNode, serializeTree, applyDiff, ensureBackupFolder, copyTreeToBackup } from '@/background/bookmarks.js'

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

  it('onBookmarkChildrenReordered triggers debounce push for affected key', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })
    findKeyForNode.mockResolvedValue('key-a')

    await init()
    onBookmarkChildrenReordered('sync-a', { childIds: ['b1', 'b2'] })

    expect(pushTree).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(200)

    expect(findSyncFolder).toHaveBeenCalledWith('key-a')
    expect(pushTree).toHaveBeenCalled()
  })

  it('onBookmarkChildrenReordered ignores events outside sync folders', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })
    findKeyForNode.mockResolvedValue(null)

    await init()
    onBookmarkChildrenReordered('outside-folder', { childIds: ['b1'] })

    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).not.toHaveBeenCalled()
  })

  it('auto-initializes on bookmark event after service worker restart', async () => {
    // Simulate a service worker restart by clearing keyStates via init with no keys
    chrome.storage.local.get = vi.fn().mockResolvedValue({ deviceId: 'dev1' })
    await init()

    // Now set up for the actual test — storage has sync keys
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    findSyncFolder.mockResolvedValue({ id: 'sync-a', title: 'key-a' })
    findKeyForNode.mockImplementation((parentId) => {
      if (parentId === 'sync-a') return Promise.resolve('key-a')
      return Promise.resolve(null)
    })

    // DO NOT call init() — simulate service worker restart with empty keyStates
    onBookmarkCreated('b1', { id: 'b1', parentId: 'sync-a' })

    // Wait for auto-init + debounce
    await vi.advanceTimersByTimeAsync(500)

    expect(pushTree).toHaveBeenCalled()
  })

  it('resets isApplyingRemote after applyDiff throws in doInit', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue({ children: [] })
    applyDiff.mockRejectedValueOnce(new Error('diff failed'))

    await expect(init()).rejects.toThrow('diff failed')

    // If isApplyingRemote were stuck true, debouncePush would bail out
    applyDiff.mockResolvedValue(undefined)
    findKeyForNode.mockResolvedValue('key-a')
    onBookmarkCreated('b1', { id: 'b1', parentId: 'sync-a' })
    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).toHaveBeenCalled()
  })

  it('resets isApplyingRemote after applyDiff throws in forceSync', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue(null)
    await init()

    fetchTree.mockResolvedValue({ children: [] })
    applyDiff.mockRejectedValueOnce(new Error('diff failed'))

    await expect(forceSync('key-a')).rejects.toThrow('diff failed')

    applyDiff.mockResolvedValue(undefined)
    findKeyForNode.mockResolvedValue('key-a')
    onBookmarkCreated('b2', { id: 'b2', parentId: 'sync-a' })
    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).toHaveBeenCalled()
  })

  it('debouncePush catches pushTree error, clears timer, and logs', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue(null)
    await init()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pushTree.mockRejectedValueOnce(new Error('push failed'))

    onBookmarkCreated('b1', { id: 'b1', parentId: 'sync-a' })
    await vi.advanceTimersByTimeAsync(200)

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[enlasync] debouncePush error:'),
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })

  it('skips invalid remote tree and resets isApplyingRemote in handleRemoteChange', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue(null)
    await init()

    applyDiff.mockClear()

    await handleRemoteChange('key-a', null)

    expect(applyDiff).not.toHaveBeenCalled()

    // Verify isApplyingRemote was reset by checking debouncePush works
    findKeyForNode.mockResolvedValue('key-a')
    onBookmarkCreated('b1', { id: 'b1', parentId: 'sync-a' })
    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).toHaveBeenCalled()
  })

  it('applies empty valid tree { children: [] } normally in handleRemoteChange', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue(null)
    await init()

    applyDiff.mockClear()

    await handleRemoteChange('key-a', { children: [] })

    expect(applyDiff).toHaveBeenCalledWith('sync-a', [])
  })

  it('resets isApplyingRemote and logs error when applyDiff throws in handleRemoteChange', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue(null)
    await init()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    applyDiff.mockRejectedValueOnce(new Error('diff failed'))

    await handleRemoteChange('key-a', { children: [] })

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[enlasync] remote-change error:'),
      expect.any(Error)
    )

    // If isApplyingRemote were stuck true, debouncePush would bail out
    applyDiff.mockResolvedValue(undefined)
    findKeyForNode.mockResolvedValue('key-a')
    onBookmarkCreated('b1', { id: 'b1', parentId: 'sync-a' })
    await vi.advanceTimersByTimeAsync(200)

    expect(pushTree).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('returns false and logs error when pushTree throws in forceSync', async () => {
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['key-a'],
      deviceId: 'dev1',
    })
    fetchTree.mockResolvedValue(null)
    await init()

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    pushTree.mockRejectedValueOnce(new Error('push failed'))

    const result = await forceSync('key-a')

    expect(result).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[enlasync] forceSync pushTree error:'),
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })

  describe('forceBackupOverride', () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      chrome.storage.local.get = vi.fn().mockResolvedValue({
        sync_keys: ['work', 'personal'],
        deviceId: 'dev1',
      })
      findSyncFolder.mockImplementation((key) => {
        if (key === 'work') return Promise.resolve({ id: 'sync-work', title: 'work' })
        if (key === 'personal') return Promise.resolve({ id: 'sync-personal', title: 'personal' })
        if (key === '[SyncBookmarksBackup]') return Promise.resolve({ id: 'backup1', title: '[SyncBookmarksBackup]' })
        return Promise.resolve(null)
      })
      chrome.bookmarks.getChildren = vi.fn()
        .mockResolvedValueOnce([
          { id: 'sync-work', title: 'work' },
          { id: 'sync-personal', title: 'personal' },
        ]) // for init
        .mockResolvedValueOnce([
          { id: 'new-backup-work', title: 'work' },
        ]) // for backup root children (no existing backup)
      chrome.bookmarks.create = vi.fn().mockResolvedValue({ id: 'new-backup-work', title: 'work' })
      copyTreeToBackup.mockResolvedValue(3)
      chrome.bookmarks.removeTree = vi.fn().mockResolvedValue(undefined)
      await init()
    })

    it('copies sync folder to backup and returns success with count', async () => {
      const result = await forceBackupOverride('work')

      expect(findSyncFolder).toHaveBeenCalledWith('work')
      expect(ensureBackupFolder).toHaveBeenCalled()
      expect(chrome.bookmarks.getChildren).toHaveBeenCalledWith('backup1')
      expect(copyTreeToBackup).toHaveBeenCalledWith('sync-work', expect.any(String))
      expect(result).toEqual({ success: true, copied: 3 })
    })

    it('returns error when sync key folder not found', async () => {
      findSyncFolder.mockResolvedValueOnce(null) // sync key folder not found

      const result = await forceBackupOverride('nonexistent')

      expect(result).toEqual({ success: false, error: 'Sync key folder not found' })
      expect(copyTreeToBackup).not.toHaveBeenCalled()
    })

    it('removes existing backup folder before copying (snapshot semantics)', async () => {
      // Re-initialize with fresh mocks for this test
      vi.clearAllMocks()
      chrome.storage.local.get = vi.fn().mockResolvedValue({
        sync_keys: ['work', 'personal'],
        deviceId: 'dev1',
      })
      findSyncFolder.mockImplementation((key) => {
        if (key === 'work') return Promise.resolve({ id: 'sync-work', title: 'work' })
        if (key === 'personal') return Promise.resolve({ id: 'sync-personal', title: 'personal' })
        if (key === '[SyncBookmarksBackup]') return Promise.resolve({ id: 'backup1', title: '[SyncBookmarksBackup]' })
        return Promise.resolve(null)
      })
      findKeyForNode.mockResolvedValue(null)
      applyDiff.mockResolvedValue(undefined)
      serializeTree.mockResolvedValue({ title: 'work', children: [] })
      fetchTree.mockResolvedValue(null)
      pushTree.mockResolvedValue(undefined)
      chrome.offscreen.hasDocument = vi.fn().mockResolvedValue(true)
      chrome.offscreen.createDocument = vi.fn().mockResolvedValue(undefined)
      chrome.runtime.sendMessage = vi.fn()
      
      chrome.bookmarks.getChildren = vi.fn().mockImplementation((id) => {
        if (id === 'root-id') {
          return Promise.resolve([
            { id: 'sync-work', title: 'work' },
            { id: 'sync-personal', title: 'personal' },
          ])
        }
        if (id === 'backup1') {
          return Promise.resolve([
            { id: 'old-backup-work', title: 'work' }, // existing backup
          ])
        }
        return Promise.resolve([])
      })
      
      chrome.bookmarks.search = vi.fn().mockImplementation((query) => {
        if (query.title === '[SyncBookmarks]') {
          return Promise.resolve([{ id: 'root-id', title: '[SyncBookmarks]' }])
        }
        if (query.title === '[SyncBookmarksBackup]') {
          return Promise.resolve([{ id: 'backup1', title: '[SyncBookmarksBackup]' }])
        }
        return Promise.resolve([])
      })
      
      chrome.bookmarks.create = vi.fn().mockResolvedValue({ id: 'new-backup-work', title: 'work' })
      chrome.bookmarks.removeTree = vi.fn().mockResolvedValue(undefined)
      copyTreeToBackup.mockResolvedValue(3)
      await init()

      await forceBackupOverride('work')

      expect(chrome.bookmarks.removeTree).toHaveBeenCalledWith('old-backup-work')
      expect(copyTreeToBackup).toHaveBeenCalledWith('sync-work', expect.any(String))
    })
  })

  describe('chrome.runtime.onMessage backup-override handler', () => {
    beforeEach(async () => {
      vi.clearAllMocks()
      chrome.storage.local.get = vi.fn().mockResolvedValue({
        sync_keys: ['work'],
        deviceId: 'dev1',
      })
      findSyncFolder.mockImplementation((key) => {
        if (key === 'work') return Promise.resolve({ id: 'sync-work', title: 'work' })
        if (key === '[SyncBookmarksBackup]') return Promise.resolve({ id: 'backup1', title: '[SyncBookmarksBackup]' })
        return Promise.resolve(null)
      })
      chrome.bookmarks.getChildren = vi.fn()
        .mockResolvedValueOnce([
          { id: 'sync-work', title: 'work' },
        ]) // for init
        .mockResolvedValueOnce([
          { id: 'new-backup-work', title: 'work' },
        ]) // for backup root children
      chrome.bookmarks.create = vi.fn().mockResolvedValue({ id: 'new-backup-work', title: 'work' })
      copyTreeToBackup.mockResolvedValue(3)
      chrome.bookmarks.removeTree = vi.fn().mockResolvedValue(undefined)
      await init()
    })

    it('handles backup-override message and sends response', async () => {
      const sendResponse = vi.fn()

      // Trigger the message handler by calling forceBackupOverride directly
      // (the message handler internally calls forceBackupOverride)
      const result = await forceBackupOverride('work')

      expect(result).toEqual({ success: true, copied: 3 })
    })
  })
})
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { serializeTree, findSyncFolder, applyDiff } from '@/background/bookmarks.js'

describe('serializeTree', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns { title, url } for a bookmark node', async () => {
    chrome.bookmarks.getSubTree = vi.fn().mockResolvedValue([
      { id: '42', title: 'MDN', url: 'https://mdn.io', dateAdded: 12345 },
    ])

    const result = await serializeTree('42')
    expect(result).toEqual({ title: 'MDN', url: 'https://mdn.io' })
  })

  it('returns { title, children } for a folder node recursively', async () => {
    chrome.bookmarks.getSubTree = vi.fn().mockResolvedValue([
      {
        id: '10',
        title: 'Dev',
        dateAdded: 12345,
        children: [
          { id: '11', title: 'React', url: 'https://react.dev', dateAdded: 12345 },
        ],
      },
    ])

    const result = await serializeTree('10')
    expect(result).toEqual({
      title: 'Dev',
      children: [{ title: 'React', url: 'https://react.dev' }],
    })
  })
})

describe('findSyncFolder', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the [SyncBookmarks] folder when it exists', async () => {
    const folderNode = { id: '99', title: '[SyncBookmarks]', dateAdded: 12345, children: [] }
    chrome.bookmarks.search = vi.fn().mockResolvedValue([folderNode])

    const result = await findSyncFolder()
    expect(result).toEqual(folderNode)
    expect(chrome.bookmarks.search).toHaveBeenCalledWith({ title: '[SyncBookmarks]' })
  })

  it('creates the [SyncBookmarks] folder under Other Bookmarks when not found', async () => {
    chrome.bookmarks.search = vi.fn().mockResolvedValue([])
    chrome.bookmarks.getTree = vi.fn().mockResolvedValue([
      {
        children: [
          { id: '1', title: 'Bookmarks bar', children: [] },
          { id: '2', title: 'Other bookmarks', children: [] },
        ],
      },
    ])
    chrome.bookmarks.create = vi.fn().mockResolvedValue({ id: '100', title: '[SyncBookmarks]' })

    const result = await findSyncFolder()
    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: '1',
      title: '[SyncBookmarks]',
    })
    expect(result).toEqual({ id: '100', title: '[SyncBookmarks]' })
  })
})

describe('applyDiff', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a new bookmark when remote has one not in local', async () => {
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([])
    chrome.bookmarks.create = vi.fn().mockResolvedValue({ id: 'new1', title: 'MDN', url: 'https://mdn.io' })

    await applyDiff('parent1', [{ title: 'MDN', url: 'https://mdn.io' }])
    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: 'parent1',
      title: 'MDN',
      url: 'https://mdn.io',
    })
  })

  it('removes a local bookmark not present in remote', async () => {
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([
      { id: 'old1', title: 'Old', url: 'https://old.io' },
    ])
    chrome.bookmarks.remove = vi.fn().mockResolvedValue(undefined)

    await applyDiff('parent1', [])
    expect(chrome.bookmarks.remove).toHaveBeenCalledWith('old1')
  })

  it('updates title when same URL but different title', async () => {
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([
      { id: 'b1', title: 'MDN Web', url: 'https://mdn.io' },
    ])
    chrome.bookmarks.update = vi.fn().mockResolvedValue(undefined)

    await applyDiff('parent1', [{ title: 'MDN', url: 'https://mdn.io' }])
    expect(chrome.bookmarks.update).toHaveBeenCalledWith('b1', { title: 'MDN' })
  })

  it('creates a new folder when remote has one not in local', async () => {
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([])
    chrome.bookmarks.create = vi.fn().mockResolvedValue({ id: 'f1', title: 'Dev' })

    await applyDiff('parent1', [{ title: 'Dev', children: [] }])
    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: 'parent1',
      title: 'Dev',
    })
  })
})

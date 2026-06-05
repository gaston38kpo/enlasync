import { describe, it, expect, vi, beforeEach } from 'vitest'
import { serializeTree, findSyncFolder, findKeyForNode, ROOT_TITLE, applyDiff } from '@/background/bookmarks.js'

describe('ROOT_TITLE', () => {
  it('exports the expected constant', () => {
    expect(ROOT_TITLE).toBe('[SyncBookmarks]')
  })
})

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
    const existingSub = { id: '100', title: 'my-key', dateAdded: 12345 }
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([existingSub])

    const result = await findSyncFolder('my-key')
    expect(result).toEqual(existingSub)
    expect(chrome.bookmarks.search).toHaveBeenCalledWith({ title: '[SyncBookmarks]' })
  })

  it('creates the [SyncBookmarks] root and a sync-key subfolder when not found', async () => {
    const rootFolder = { id: '1', title: '[SyncBookmarks]', dateAdded: 12345 }

    chrome.bookmarks.search = vi.fn().mockResolvedValue([])
    chrome.bookmarks.create = vi.fn()
      .mockResolvedValueOnce(rootFolder)
      .mockResolvedValueOnce({ id: '100', title: 'my-key' })
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([])

    const result = await findSyncFolder('my-key')

    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: '1',
      title: '[SyncBookmarks]',
    })
    expect(chrome.bookmarks.create).toHaveBeenCalledWith({
      parentId: rootFolder.id,
      title: 'my-key',
    })
    expect(result).toEqual({ id: '100', title: 'my-key' })
  })

  it('returns existing sync-key subfolder under [SyncBookmarks]', async () => {
    const rootFolder = { id: '10', title: '[SyncBookmarks]', dateAdded: 12345 }
    const existingSub = { id: '20', title: 'my-key', dateAdded: 12345 }

    chrome.bookmarks.search = vi.fn().mockResolvedValue([rootFolder])
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([existingSub])

    const result = await findSyncFolder('my-key')

    expect(result).toEqual(existingSub)
    expect(chrome.bookmarks.create).not.toHaveBeenCalled()
  })
})

describe('findKeyForNode', () => {
  // Helper to create a mock chrome.bookmarks.get that returns nodes by ID
  function makeMockGet(nodesById) {
    return vi.fn().mockImplementation((id) => {
      const node = nodesById[id]
      return node ? Promise.resolve([node]) : Promise.reject(new Error(`Node ${id} not found`))
    })
  }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the sync key for a bookmark directly under a key folder', async () => {
    // Structure: [SyncBookmarks](99) > key-a(100) > bookmark(101)
    chrome.bookmarks.get = makeMockGet({
      '99': { id: '99', title: '[SyncBookmarks]', parentId: '1' },
      '100': { id: '100', title: 'key-a', parentId: '99' },
      '101': { id: '101', title: 'MDN', url: 'https://mdn.io', parentId: '100' },
    })

    const result = await findKeyForNode('101')
    expect(result).toBe('key-a')
  })

  it('returns the sync key for a deeply nested bookmark', async () => {
    // Structure: [SyncBookmarks](99) > key-b(200) > folder1(201) > subfolder(202) > bookmark(203)
    chrome.bookmarks.get = makeMockGet({
      '99': { id: '99', title: '[SyncBookmarks]', parentId: '1' },
      '200': { id: '200', title: 'key-b', parentId: '99' },
      '201': { id: '201', title: 'folder1', parentId: '200' },
      '202': { id: '202', title: 'subfolder', parentId: '201' },
      '203': { id: '203', title: 'MDN', url: 'https://mdn.io', parentId: '202' },
    })

    const result = await findKeyForNode('203')
    expect(result).toBe('key-b')
  })

  it('returns null for a bookmark outside any sync folder', async () => {
    // Structure: Bookmarks bar(1) > Other Stuff(50) > bookmark(51)
    // Bookmarks bar has parentId '0', so walking up from 51 → 50 → 1 → '0' returns null
    chrome.bookmarks.get = makeMockGet({
      '1': { id: '1', title: 'Bookmarks bar', parentId: '0' },
      '50': { id: '50', title: 'Other Stuff', parentId: '1' },
      '51': { id: '51', title: 'MDN', url: 'https://mdn.io', parentId: '50' },
    })

    const result = await findKeyForNode('51')
    expect(result).toBeNull()
  })

  it('returns null for a node at root level', async () => {
    chrome.bookmarks.get = makeMockGet({
      '0': { id: '0', title: '', parentId: undefined },
    })

    const result = await findKeyForNode('0')
    expect(result).toBeNull()
  })

  it('returns the key when the node IS a sync key folder', async () => {
    // Structure: [SyncBookmarks](99) > key-a(100)
    chrome.bookmarks.get = makeMockGet({
      '99': { id: '99', title: '[SyncBookmarks]', parentId: '1' },
      '100': { id: '100', title: 'key-a', parentId: '99' },
    })

    const result = await findKeyForNode('100')
    expect(result).toBe('key-a')
  })

  it('returns the title for a bookmark directly in [SyncBookmarks] (no key subfolder)', async () => {
    const rootNode = { id: '99', title: '[SyncBookmarks]', parentId: '1' }
    chrome.bookmarks.get = makeMockGet({
      '99': rootNode,
      '150': { id: '150', title: 'loose', url: 'https://loose.io', parentId: '99' },
    })

    // A direct child of [SyncBookmarks] returns its own title
    const result = await findKeyForNode('150')
    expect(result).toBe('loose')
  })

  it('returns null when chrome.bookmarks.get rejects (missing node)', async () => {
    chrome.bookmarks.get = vi.fn().mockRejectedValue(new Error('Node not found'))

    const result = await findKeyForNode('999')
    expect(result).toBeNull()
  })

  it('returns null when a cycle is detected (parent points back to child)', async () => {
    // Create a cycle: node A -> node B -> node A
    const nodeA = { id: 'a', title: 'A', parentId: 'b' }
    const nodeB = { id: 'b', title: 'B', parentId: 'a' }
    chrome.bookmarks.get = vi.fn().mockImplementation((id) => {
      if (id === 'a') return Promise.resolve([nodeA])
      if (id === 'b') return Promise.resolve([nodeB])
      return Promise.reject(new Error('Node not found'))
    })

    const result = await findKeyForNode('a')
    expect(result).toBeNull()
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

  it('logs error and continues when a single chrome.bookmarks.create throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([])
    chrome.bookmarks.create = vi.fn()
      .mockRejectedValueOnce(new Error('create failed'))
      .mockResolvedValueOnce({ id: 'ok1', title: 'OK', url: 'https://ok.io' })

    await applyDiff('parent1', [
      { title: 'Fail', url: 'https://fail.io' },
      { title: 'OK', url: 'https://ok.io' },
    ])

    expect(chrome.bookmarks.create).toHaveBeenCalledTimes(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[enlasync] applyDiff error:'),
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })

  it('logs error and continues when a single chrome.bookmarks.remove throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chrome.bookmarks.getChildren = vi.fn().mockResolvedValue([
      { id: 'old1', title: 'Old', url: 'https://old.io' },
      { id: 'old2', title: 'Keep', url: 'https://keep.io' },
    ])
    chrome.bookmarks.remove = vi.fn()
      .mockRejectedValueOnce(new Error('remove failed'))
      .mockResolvedValueOnce(undefined)

    await applyDiff('parent1', [])

    expect(chrome.bookmarks.remove).toHaveBeenCalledTimes(2)
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[enlasync] applyDiff error:'),
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })
})
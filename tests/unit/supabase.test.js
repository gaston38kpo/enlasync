import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/background/crypto.js', () => ({
  encrypt: vi.fn(async (_tree, syncKey) => ({
    v: 1,
    salt: 'mock-salt',
    iv: 'mock-iv',
    ct: `encrypted-with-${syncKey}`,
  })),
  safeDecrypt: vi.fn(async (value, syncKey) => {
    if (value === null || value === undefined) return null
    if (value.v === 1) return { decrypted: true, original: value.ct }
    return value
  }),
}))

import { pushTree, fetchTree, createSupabaseClient, subscribeToRemote, removeChannel } from '@/background/supabase.js'
import { encrypt, safeDecrypt } from '@/background/crypto.js'

describe('pushTree', () => {
  let mockSupabase

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    vi.clearAllMocks()
  })

  it('encrypts tree before upsert', async () => {
    const tree = { title: '[SyncBookmarks]', children: [{ title: 'MDN', url: 'https://mdn.io' }] }
    await pushTree(mockSupabase, 'abc', 'dev1', tree)

    expect(encrypt).toHaveBeenCalledWith(tree, 'abc')
    expect(mockSupabase.from).toHaveBeenCalledWith('bookmark_syncs')
    expect(mockSupabase.upsert).toHaveBeenCalledWith({
      sync_key: 'abc',
      tree: {
        v: 1,
        salt: 'mock-salt',
        iv: 'mock-iv',
        ct: 'encrypted-with-abc',
      },
      updated_by: 'dev1',
    })
  })

  it('throws when supabase upsert fails', async () => {
    mockSupabase.upsert.mockResolvedValue({ data: null, error: { message: 'upsert failed' } })

    const tree = { title: 'T', children: [] }
    await expect(pushTree(mockSupabase, 'abc', 'dev1', tree))
      .rejects.toThrow('[enlasync] pushTree failed: upsert failed')
  })

  it('throws when encrypt fails', async () => {
    encrypt.mockRejectedValueOnce(new Error('encrypt failed'))

    const tree = { title: 'T', children: [] }
    await expect(pushTree(mockSupabase, 'abc', 'dev1', tree))
      .rejects.toThrow('[enlasync] pushTree failed: encrypt failed')
  })
})

describe('fetchTree', () => {
  let mockSupabase

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }
    vi.clearAllMocks()
  })

  it('decrypts encrypted tree', async () => {
    const encryptedTree = { v: 1, salt: 's', iv: 'i', ct: 'c' }
    mockSupabase.single.mockResolvedValue({ data: { tree: encryptedTree }, error: null })

    const result = await fetchTree(mockSupabase, 'key1')

    expect(safeDecrypt).toHaveBeenCalledWith(encryptedTree, 'key1')
    expect(result).toEqual({ decrypted: true, original: 'c' })
  })

  it('returns null when supabase returns null', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: null })

    const result = await fetchTree(mockSupabase, 'key1')

    expect(safeDecrypt).toHaveBeenCalledWith(null, 'key1')
    expect(result).toBeNull()
  })

  it('passes through legacy plaintext', async () => {
    const legacyTree = { title: 'Legacy', children: [] }
    mockSupabase.single.mockResolvedValue({ data: { tree: legacyTree }, error: null })

    const result = await fetchTree(mockSupabase, 'key1')

    expect(safeDecrypt).toHaveBeenCalledWith(legacyTree, 'key1')
    expect(result).toEqual(legacyTree)
  })

  it('returns null when safeDecrypt throws', async () => {
    mockSupabase.single.mockResolvedValue({ data: { tree: { v: 1 } }, error: null })
    safeDecrypt.mockRejectedValue(new Error('decrypt failed'))

    const result = await fetchTree(mockSupabase, 'key1')

    expect(result).toBeNull()
  })

  it('returns null on supabase error', async () => {
    mockSupabase.single.mockResolvedValue({ data: null, error: { message: 'db error' } })

    const result = await fetchTree(mockSupabase, 'key1')

    expect(result).toBeNull()
  })
})

describe('createSupabaseClient', () => {
  it('returns a supabase client', () => {
    const client = createSupabaseClient()
    expect(client).toBeDefined()
    expect(typeof client.from).toBe('function')
  })
})

describe('removeChannel', () => {
  it('delegates to supabase removeChannel', () => {
    const mockChannel = { name: 'test-channel' }
    const mockSupabase = {
      removeChannel: vi.fn().mockReturnValue(mockChannel),
    }

    removeChannel(mockSupabase, mockChannel)

    expect(mockSupabase.removeChannel).toHaveBeenCalledWith(mockChannel)
  })
})

describe('subscribeToRemote', () => {
  let mockSupabase
  let registeredCallback
  const channelMock = {
    on: vi.fn((_event, _filter, callback) => {
      registeredCallback = callback
      return channelMock
    }),
    subscribe: vi.fn(),
  }

  beforeEach(() => {
    registeredCallback = null
    mockSupabase = {
      channel: vi.fn().mockReturnValue(channelMock),
    }
    vi.clearAllMocks()
  })

  it('calls onRemoteTree when updated_by differs from deviceId', () => {
    const onRemoteTree = vi.fn()
    subscribeToRemote(mockSupabase, 'key1', 'dev1', onRemoteTree)

    expect(mockSupabase.channel).toHaveBeenCalled()
    expect(channelMock.subscribe).toHaveBeenCalled()

    const payload = { new: { updated_by: 'dev2', tree: { title: 'T' } } }
    registeredCallback(payload)

    expect(onRemoteTree).toHaveBeenCalledWith({ title: 'T' })
  })

  it('does NOT call onRemoteTree when updated_by equals deviceId', () => {
    const onRemoteTree = vi.fn()
    subscribeToRemote(mockSupabase, 'key1', 'dev1', onRemoteTree)

    const payload = { new: { updated_by: 'dev1', tree: { title: 'T' } } }
    registeredCallback(payload)

    expect(onRemoteTree).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pushTree, createSupabaseClient, subscribeToRemote } from '@/background/supabase.js'

describe('pushTree', () => {
  let mockSupabase

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  it('calls supabase upsert with correct payload shape', async () => {
    const tree = { title: '[SyncBookmarks]', children: [{ title: 'MDN', url: 'https://mdn.io' }] }
    await pushTree(mockSupabase, 'abc', 'dev1', tree)

    expect(mockSupabase.from).toHaveBeenCalledWith('bookmark_syncs')
    expect(mockSupabase.upsert).toHaveBeenCalledWith({
      sync_key: 'abc',
      tree,
      updated_by: 'dev1',
    })
  })
})

describe('createSupabaseClient', () => {
  it('returns a supabase client', () => {
    const client = createSupabaseClient()
    expect(client).toBeDefined()
    expect(typeof client.from).toBe('function')
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

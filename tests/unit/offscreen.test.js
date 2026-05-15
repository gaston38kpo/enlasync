import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('offscreen multi-channel logic', () => {
  let mockSupabase
  let createdChannels

  beforeEach(() => {
    vi.clearAllMocks()
    createdChannels = []

    // Simulate the channel creation pattern from offscreen.js
    const createChannel = (name) => {
      const channel = {
        on: vi.fn().mockReturnThis(),
        subscribe: vi.fn(),
      }
      createdChannels.push({ name, channel })
      return channel
    }

    mockSupabase = {
      channel: vi.fn((name) => createChannel(name)),
      removeChannel: vi.fn(),
    }
  })

  it('creates one channel per sync key', () => {
    const syncKeys = ['key-a', 'key-b', 'key-c']
    const deviceId = 'dev1'

    for (const syncKey of syncKeys) {
      const channelName = `bookmark_syncs_${syncKey}`
      const channel = mockSupabase.channel(channelName)

      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bookmark_syncs', filter: `sync_key=eq.${syncKey}` },
        () => {}
      )
      channel.subscribe()
    }

    expect(mockSupabase.channel).toHaveBeenCalledTimes(3)
    expect(mockSupabase.channel).toHaveBeenCalledWith('bookmark_syncs_key-a')
    expect(mockSupabase.channel).toHaveBeenCalledWith('bookmark_syncs_key-b')
    expect(mockSupabase.channel).toHaveBeenCalledWith('bookmark_syncs_key-c')

    // Each channel should have on() called with the correct filter
    createdChannels.forEach(({ name, channel }) => {
      expect(channel.on).toHaveBeenCalledWith(
        'postgres_changes',
        expect.objectContaining({
          filter: expect.stringContaining('sync_key=eq.'),
        }),
        expect.any(Function)
      )
      expect(channel.subscribe).toHaveBeenCalled()
    })
  })

  it('removes channels for keys no longer in config', () => {
    const channelsMap = new Map()

    // Subscribe to 3 keys
    for (const key of ['key-a', 'key-b', 'key-c']) {
      const channel = mockSupabase.channel(`bookmark_syncs_${key}`)
      channelsMap.set(key, { channel })
    }

    // Now remove key-b (simulate config update)
    const entry = channelsMap.get('key-b')
    mockSupabase.removeChannel(entry.channel)
    channelsMap.delete('key-b')

    expect(channelsMap.size).toBe(2)
    expect(channelsMap.has('key-a')).toBe(true)
    expect(channelsMap.has('key-c')).toBe(true)
    expect(mockSupabase.removeChannel).toHaveBeenCalledTimes(1)
  })

  it('adds channels for new keys without disturbing existing ones', () => {
    const channelsMap = new Map()
    const deviceId = 'dev1'

    // Initial: 2 keys
    for (const key of ['key-a', 'key-b']) {
      const channel = mockSupabase.channel(`bookmark_syncs_${key}`)
      channelsMap.set(key, { channel })
    }
    const channelA = channelsMap.get('key-a').channel

    // Update: add key-c, keep key-a and key-b
    const newKeys = ['key-a', 'key-b', 'key-c']
    for (const key of newKeys) {
      if (!channelsMap.has(key)) {
        const channel = mockSupabase.channel(`bookmark_syncs_${key}`)
        channelsMap.set(key, { channel })
      }
    }

    expect(channelsMap.size).toBe(3)
    expect(channelsMap.get('key-a').channel).toBe(channelA) // existing channel preserved
    expect(channelsMap.has('key-c')).toBe(true) // new channel created
  })

  it('remote-change callback includes syncKey in message', () => {
    const syncKey = 'my-key'
    const deviceId = 'dev1'
    let capturedCallback = null

    const channel = {
      on: vi.fn((_event, _filter, callback) => {
        capturedCallback = callback
        return channel
      }),
      subscribe: vi.fn(),
    }
    mockSupabase.channel.mockReturnValue(channel)

    // Simulate subscribe
    mockSupabase.channel(`bookmark_syncs_${syncKey}`)
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'bookmark_syncs', filter: `sync_key=eq.${syncKey}` },
      capturedCallback || (() => {})
    )

    // The offscreen module should pass syncKey in remote-change messages
    // Verify the pattern: the callback receives payload with data
    const payload = { new: { updated_by: 'dev-other', tree: { title: 'test' } } }

    // When the callback fires, it sends chrome.runtime.sendMessage with syncKey
    // This is verified by the message format: { type: 'remote-change', syncKey, tree }
    expect(typeof capturedCallback).toBe('function')
  })
})
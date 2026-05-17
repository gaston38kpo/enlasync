import { createSupabaseClient } from '../background/supabase.js'
import { safeDecrypt } from '../background/crypto.js'

let supabase = null
/** @type {Map<string, { channel: object }>} */
const channels = new Map()

function subscribeToKey(syncKey, deviceId) {
  if (channels.has(syncKey)) return

  const channel = supabase
    .channel(`bookmark_syncs_${syncKey}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bookmark_syncs',
        filter: `sync_key=eq.${syncKey}`,
      },
      async (payload) => {
        if (payload.new?.updated_by !== deviceId) {
          try {
            const decrypted = await safeDecrypt(payload.new.tree, syncKey)
            chrome.runtime.sendMessage({ type: 'remote-change', syncKey, tree: decrypted })
          } catch (err) {
            console.error('[enlasync] offscreen decrypt error:', err)
          }
        }
      }
    )
    .subscribe((status) => {
      console.log(`[enlasync] offscreen realtime status for ${syncKey}:`, status)
    })

  channels.set(syncKey, { channel })
}

function unsubscribeFromKey(syncKey) {
  const entry = channels.get(syncKey)
  if (!entry) return
  supabase.removeChannel(entry.channel)
  channels.delete(syncKey)
}

function setup(syncKeys, deviceId) {
  supabase = supabase || createSupabaseClient()

  // Unsubscribe from keys no longer in the list
  for (const key of channels.keys()) {
    if (!syncKeys.includes(key)) {
      unsubscribeFromKey(key)
    }
  }

  // Subscribe to new keys
  for (const key of syncKeys) {
    subscribeToKey(key, deviceId)
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'offscreen-config') {
    setup(message.syncKeys, message.deviceId)
  }
})

// Let the service worker know we're ready
chrome.runtime.sendMessage({ type: 'offscreen-ready' })
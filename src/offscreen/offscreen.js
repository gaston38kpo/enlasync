import { createSupabaseClient } from '../background/supabase.js'

let supabase = null
let channel = null

function setup(syncKey, deviceId) {
  supabase = createSupabaseClient()

  if (channel) {
    supabase.removeChannel(channel)
  }

  channel = supabase
    .channel('bookmark_syncs_changes')
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'bookmark_syncs',
        filter: `sync_key=eq.${syncKey}`,
      },
      (payload) => {
        if (payload.new?.updated_by !== deviceId) {
          chrome.runtime.sendMessage({ type: 'remote-change', tree: payload.new.tree })
        }
      }
    )
    .subscribe((status) => {
      console.log('[enlasync] offscreen realtime status:', status)
    })
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'offscreen-init') {
    setup(message.syncKey, message.deviceId)
  }
})

// Avisarle al SW que estamos listos para recibir config
chrome.runtime.sendMessage({ type: 'offscreen-ready' })

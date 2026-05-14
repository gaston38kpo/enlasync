import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = 'placeholder-anon-key'

export function createSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

export async function pushTree(supabase, syncKey, deviceId, tree) {
  await supabase.from('bookmark_syncs').upsert({
    sync_key: syncKey,
    tree,
    updated_by: deviceId,
  })
}

export function subscribeToRemote(supabase, syncKey, deviceId, onRemoteTree) {
  supabase
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
          onRemoteTree(payload.new.tree)
        }
      }
    )
    .subscribe()
}

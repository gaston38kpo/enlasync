import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ijkyywqtglavunczlsyz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlqa3l5d3F0Z2xhdnVuY3psc3l6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxOTkwOTEsImV4cCI6MjA5Mzc3NTA5MX0.vEPNgBZL3qjy3LNzq5thWA8TzYZnNB_Cr9I0dtfeexs'

export function createSupabaseClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
}

export async function pushTree(supabase, syncKey, deviceId, tree) {
  const { error } = await supabase.from('bookmark_syncs').upsert({
    sync_key: syncKey,
    tree,
    updated_by: deviceId,
  })
  if (error) console.error('[enlasync] pushTree error:', error)
}

export async function fetchTree(supabase, syncKey) {
  const { data, error } = await supabase
    .from('bookmark_syncs')
    .select('tree')
    .eq('sync_key', syncKey)
    .single()
  if (error) {
    console.error('[enlasync] fetchTree error:', error)
    return null
  }
  return data?.tree ?? null
}

export function removeChannel(supabase, channel) {
  return supabase.removeChannel(channel)
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

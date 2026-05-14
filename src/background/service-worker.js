import { createSupabaseClient, pushTree, subscribeToRemote } from './supabase.js'
import { findSyncFolder, applyDiff, serializeTree } from './bookmarks.js'

export let isApplyingRemote = false
let supabase = null
let syncKey = ''
let deviceId = ''
let debounceTimer = null

export async function init() {
  const stored = await chrome.storage.local.get(['sync_key', 'deviceId'])
  syncKey = stored.sync_key || ''
  deviceId = stored.deviceId || crypto.randomUUID()
  if (!stored.deviceId) {
    await chrome.storage.local.set({ deviceId })
  }
  supabase = createSupabaseClient()
  subscribeToRemote(supabase, syncKey, deviceId, async (remoteTree) => {
    isApplyingRemote = true
    const folder = await findSyncFolder()
    await applyDiff(folder.id, remoteTree.children || [])
    isApplyingRemote = false
  })
}

export function onLocalChange() {
  if (isApplyingRemote) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    const folder = await findSyncFolder()
    const tree = await serializeTree(folder.id)
    await pushTree(supabase, syncKey, deviceId, tree)
  }, 200)
}

chrome.runtime.onStartup.addListener(init)
chrome.runtime.onInstalled.addListener(init)
chrome.bookmarks.onCreated.addListener(onLocalChange)
chrome.bookmarks.onRemoved.addListener(onLocalChange)
chrome.bookmarks.onChanged.addListener(onLocalChange)
chrome.bookmarks.onMoved.addListener(onLocalChange)

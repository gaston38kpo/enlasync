import { createSupabaseClient, pushTree, fetchTree } from './supabase.js'
import { findSyncFolder, applyDiff, serializeTree } from './bookmarks.js'

export let isApplyingRemote = false
let supabase = null
let syncKey = ''
let deviceId = ''
let debounceTimer = null
let initPromise = null

async function setupOffscreen() {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('src/offscreen/offscreen.html'),
    reasons: ['DOM_SCRAPING'],
    justification: 'Maintain Supabase Realtime WebSocket for bookmark sync',
  })
}

export async function init() {
  if (!initPromise) {
    initPromise = doInit().finally(() => { initPromise = null })
  }
  return initPromise
}

async function doInit() {
  const stored = await chrome.storage.local.get(['sync_key', 'deviceId'])
  syncKey = stored.sync_key || ''
  deviceId = stored.deviceId || crypto.randomUUID()
  if (!stored.deviceId) {
    await chrome.storage.local.set({ deviceId })
  }
  supabase = createSupabaseClient()
  await findSyncFolder()
  await setupOffscreen()

  if (syncKey) {
    const remoteTree = await fetchTree(supabase, syncKey)
    if (remoteTree) {
      isApplyingRemote = true
      const folder = await findSyncFolder()
      await applyDiff(folder.id, remoteTree.children || [])
      isApplyingRemote = false
    }
  }
}

export function onLocalChange() {
  if (isApplyingRemote) return
  if (!syncKey) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(async () => {
    if (!supabase) await init()
    const folder = await findSyncFolder()
    const tree = await serializeTree(folder.id)
    await pushTree(supabase, syncKey, deviceId, tree)
  }, 200)
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'offscreen-ready') {
    chrome.runtime.sendMessage({ type: 'offscreen-init', syncKey, deviceId })
  }

  if (message.type === 'remote-change') {
    isApplyingRemote = true
    findSyncFolder()
      .then((folder) => applyDiff(folder.id, message.tree.children || []))
      .then(() => { isApplyingRemote = false })
      .catch((err) => {
        console.error('[enlasync] remote-change error:', err)
        isApplyingRemote = false
      })
  }
})

chrome.runtime.onStartup.addListener(init)
chrome.runtime.onInstalled.addListener(init)

chrome.bookmarks.onCreated.addListener(onLocalChange)
chrome.bookmarks.onRemoved.addListener(onLocalChange)
chrome.bookmarks.onChanged.addListener(onLocalChange)
chrome.bookmarks.onMoved.addListener(onLocalChange)

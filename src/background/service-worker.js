import { createSupabaseClient, pushTree, fetchTree } from './supabase.js'
import { findSyncFolder, findKeyForNode, applyDiff, serializeTree } from './bookmarks.js'

export let isApplyingRemote = false
let supabase = null
let deviceId = ''
let initPromise = null

/** @type {Map<string, { debounceTimer: ReturnType<typeof setTimeout>|null, isApplyingRemote: boolean, folderId: string|null }>} */
const keyStates = new Map()

export function normalizeSyncKeys(keys) {
  if (!Array.isArray(keys)) return []
  return [...new Set(keys.map((k) => (typeof k === 'string' ? k.trim() : '')).filter(Boolean))]
}

export async function readSyncKeys() {
  const stored = await chrome.storage.local.get(['sync_keys', 'sync_key'])
  if (stored.sync_keys && Array.isArray(stored.sync_keys)) {
    return normalizeSyncKeys(stored.sync_keys)
  }
  if (stored.sync_key && typeof stored.sync_key === 'string' && stored.sync_key.trim()) {
    const migrated = [stored.sync_key.trim()]
    await chrome.storage.local.set({ sync_keys: migrated })
    return migrated
  }
  return []
}

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
  const stored = await chrome.storage.local.get(['sync_keys', 'sync_key', 'deviceId'])
  deviceId = stored.deviceId || crypto.randomUUID()
  if (!stored.deviceId) {
    await chrome.storage.local.set({ deviceId })
  }

  // Determine sync keys (with migration from legacy sync_key)
  let syncKeys = normalizeSyncKeys(stored.sync_keys)
  if (syncKeys.length === 0 && stored.sync_key && typeof stored.sync_key === 'string' && stored.sync_key.trim()) {
    syncKeys = [stored.sync_key.trim()]
    await chrome.storage.local.set({ sync_keys: syncKeys })
  }

  supabase = createSupabaseClient()
  await setupOffscreen()

  // Clear old state and build fresh
  keyStates.clear()

  for (const key of syncKeys) {
    keyStates.set(key, {
      debounceTimer: null,
      isApplyingRemote: false,
      folderId: null,
    })

    const remoteTree = await fetchTree(supabase, key)
    if (remoteTree) {
      keyStates.get(key).isApplyingRemote = true
      const folder = await findSyncFolder(key)
      keyStates.get(key).folderId = folder.id
      await applyDiff(folder.id, remoteTree.children || [])
      keyStates.get(key).isApplyingRemote = false
    } else {
      const folder = await findSyncFolder(key)
      keyStates.get(key).folderId = folder.id
    }
  }

  // Send full key-set config to offscreen
  chrome.runtime.sendMessage({ type: 'offscreen-config', syncKeys, deviceId })
}

async function debouncePush(syncKey) {
  // Service worker may have been restarted — ensure state is loaded
  if (keyStates.size === 0) {
    await init()
  }
  const state = keyStates.get(syncKey)
  if (!state || state.isApplyingRemote) return
  if (state.debounceTimer) clearTimeout(state.debounceTimer)

  state.debounceTimer = setTimeout(async () => {
    if (!supabase) await init()
    const folder = await findSyncFolder(syncKey)
    state.folderId = folder.id
    const tree = await serializeTree(folder.id)
    await pushTree(supabase, syncKey, deviceId, tree)
    state.debounceTimer = null
  }, 200)
}

async function getAffectedKey(parentId) {
  // Service worker may have been restarted — ensure state is loaded
  if (keyStates.size === 0) {
    await init()
  }
  const key = await findKeyForNode(parentId)
  if (key && keyStates.has(key)) return key
  return null
}

export function onBookmarkCreated(_id, bookmark) {
  if (!bookmark || !bookmark.parentId) return
  getAffectedKey(bookmark.parentId).then((key) => {
    if (key) debouncePush(key)
  })
}

export function onBookmarkRemoved(_id, removeInfo) {
  if (!removeInfo || !removeInfo.parentId) return
  getAffectedKey(removeInfo.parentId).then((key) => {
    if (key) debouncePush(key)
  })
}

export function onBookmarkChanged(id, _changeInfo) {
  chrome.bookmarks.get(id).then(([node]) => {
    if (!node || !node.parentId) return
    getAffectedKey(node.parentId).then((key) => {
      if (key) debouncePush(key)
    })
  })
}

export function onBookmarkMoved(_id, moveInfo) {
  if (!moveInfo) return
  const promises = []
  if (moveInfo.parentId) {
    promises.push(getAffectedKey(moveInfo.parentId))
  }
  if (moveInfo.oldParentId && moveInfo.oldParentId !== moveInfo.parentId) {
    promises.push(getAffectedKey(moveInfo.oldParentId))
  }
  Promise.all(promises).then((keys) => {
    const unique = new Set(keys.filter(Boolean))
    for (const key of unique) {
      debouncePush(key)
    }
  })
}

export function onBookmarkChildrenReordered(id, _reorderInfo) {
  if (!id) return
  getAffectedKey(id).then((key) => {
    if (key) debouncePush(key)
  })
}

async function forceSync(syncKey) {
  const state = keyStates.get(syncKey)
  if (!state) return false
  if (!supabase) await init()

  const remoteTree = await fetchTree(supabase, syncKey)
  if (remoteTree) {
    state.isApplyingRemote = true
    const folder = await findSyncFolder(syncKey)
    state.folderId = folder.id
    await applyDiff(folder.id, remoteTree.children || [])
    state.isApplyingRemote = false
  }

  const folder = await findSyncFolder(syncKey)
  state.folderId = folder.id
  const tree = await serializeTree(folder.id)
  await pushTree(supabase, syncKey, deviceId, tree)
  return true
}

async function forceSyncAll() {
  const results = []
  for (const key of keyStates.keys()) {
    results.push(forceSync(key))
  }
  return Promise.all(results)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'offscreen-ready') {
    const handleOffscreenReady = async () => {
      if (keyStates.size === 0) {
        await init()
      }
      const syncKeys = [...keyStates.keys()]
      chrome.runtime.sendMessage({ type: 'offscreen-config', syncKeys, deviceId })
    }
    handleOffscreenReady()
  }

  if (message.type === 'remote-change') {
    const { syncKey: remoteKey, tree } = message
    if (!remoteKey) return

    const handleRemoteChange = async () => {
      if (keyStates.size === 0) {
        await init()
      }
      if (!keyStates.has(remoteKey)) return
      const state = keyStates.get(remoteKey)
      state.isApplyingRemote = true
      try {
        const folder = await findSyncFolder(remoteKey)
        state.folderId = folder.id
        await applyDiff(folder.id, tree.children || [])
      } catch (err) {
        console.error('[enlasync] remote-change error:', err)
      } finally {
        state.isApplyingRemote = false
      }
    }
    handleRemoteChange()
  }

  if (message.type === 'force-sync') {
    const handleForceSync = async () => {
      if (keyStates.size === 0) {
        await init()
      }
      const key = message.syncKey
      if (key) {
        const result = await forceSync(key)
        sendResponse(result)
      } else {
        await forceSyncAll()
        sendResponse(true)
      }
    }
    handleForceSync().catch(() => sendResponse(false))
    return true
  }
})

chrome.runtime.onStartup.addListener(init)
chrome.runtime.onInstalled.addListener(init)

chrome.bookmarks.onCreated.addListener(onBookmarkCreated)
chrome.bookmarks.onRemoved.addListener(onBookmarkRemoved)
chrome.bookmarks.onChanged.addListener(onBookmarkChanged)
chrome.bookmarks.onMoved.addListener(onBookmarkMoved)
chrome.bookmarks.onChildrenReordered.addListener(onBookmarkChildrenReordered)
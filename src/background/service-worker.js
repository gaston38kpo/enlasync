import { createSupabaseClient, pushTree, fetchTree } from './supabase.js'
import { findSyncFolder, findKeyForNode, applyDiff, serializeTree, ensureBackupFolder, copyTreeToBackup, copyChildrenToBackup, initializeBackupIfNeeded } from './bookmarks.js'

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

function isValidTree(tree) {
  return tree !== null && tree !== undefined && typeof tree === 'object' && Array.isArray(tree.children)
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
    await chrome.storage.local.remove('sync_key')
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
    if (isValidTree(remoteTree)) {
      keyStates.get(key).isApplyingRemote = true
      try {
        const folder = await findSyncFolder(key)
        keyStates.get(key).folderId = folder.id
        await applyDiff(folder.id, remoteTree.children || [])
      } finally {
        keyStates.get(key).isApplyingRemote = false
      }
    } else {
      if (remoteTree !== null && remoteTree !== undefined) {
        console.error('[enlasync] Invalid remote tree for key:', key)
      }
      const folder = await findSyncFolder(key)
      keyStates.get(key).folderId = folder.id
    }
  }

  // Initialize backup folder on first run
  await initializeBackupIfNeeded()

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
    try {
      if (!supabase) await init()
      const folder = await findSyncFolder(syncKey)
      state.folderId = folder.id
      const tree = await serializeTree(folder.id)
      await pushTree(supabase, syncKey, deviceId, tree)
    } catch (err) {
      console.error('[enlasync] debouncePush error:', err)
    } finally {
      state.debounceTimer = null
    }
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

export async function forceSync(syncKey) {
  const state = keyStates.get(syncKey)
  if (!state) return false
  if (!supabase) await init()

  const remoteTree = await fetchTree(supabase, syncKey)
  if (isValidTree(remoteTree)) {
    state.isApplyingRemote = true
    try {
      const folder = await findSyncFolder(syncKey)
      state.folderId = folder.id
      await applyDiff(folder.id, remoteTree.children || [])
    } finally {
      state.isApplyingRemote = false
    }
  } else if (remoteTree !== null && remoteTree !== undefined) {
    console.error('[enlasync] Invalid remote tree for key:', syncKey)
  }

  const folder = await findSyncFolder(syncKey)
  state.folderId = folder.id
  const tree = await serializeTree(folder.id)
  try {
    await pushTree(supabase, syncKey, deviceId, tree)
  } catch (err) {
    console.error('[enlasync] forceSync pushTree error:', err)
    return false
  }
  return true
}

async function forceSyncAll() {
  const results = []
  for (const key of keyStates.keys()) {
    results.push(forceSync(key))
  }
  return Promise.all(results)
}

export async function handleRemoteChange(remoteKey, tree) {
  if (!isValidTree(tree)) {
    if (tree !== null && tree !== undefined) {
      console.error('[enlasync] Invalid remote tree for key:', remoteKey)
    }
    return
  }
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

export async function forceBackupOverride(syncKey) {
  // Find the sync folder under [SyncBookmarks]
  const syncFolder = await findSyncFolder(syncKey)
  if (!syncFolder) {
    return { success: false, error: 'Sync key folder not found' }
  }

  // Ensure backup root exists
  const backupRoot = await ensureBackupFolder()
  if (!backupRoot) {
    return { success: false, error: 'Backup root folder not found' }
  }

  // Find or create corresponding folder under backup root
  const backupChildren = await chrome.bookmarks.getChildren(backupRoot.id)
  const existingBackup = backupChildren.find((c) => !c.url && c.title === syncKey)

  if (existingBackup) {
    // Remove existing backup folder (snapshot semantics - replace not merge)
    try {
      await chrome.bookmarks.removeTree(existingBackup.id)
    } catch (err) {
      console.error('[enlasync] forceBackupOverride removeTree error:', err)
      return { success: false, error: 'Failed to remove existing backup' }
    }
  }

  // Create new backup folder
  const newBackupFolder = await chrome.bookmarks.create({
    parentId: backupRoot.id,
    title: syncKey,
  })

  // Copy children to backup (avoid duplicating the root folder)
  const copied = await copyChildrenToBackup(syncFolder.id, newBackupFolder.id)

  return { success: true, copied }
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
    handleRemoteChange(remoteKey, tree)
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

  if (message.type === 'backup-override') {
    const handleBackupOverride = async () => {
      if (keyStates.size === 0) {
        await init()
      }
      const syncKey = message.syncKey
      if (!syncKey) {
        sendResponse({ success: false, error: 'Missing syncKey' })
        return
      }
      const result = await forceBackupOverride(syncKey)
      sendResponse(result)
    }
    handleBackupOverride().catch((err) => {
      console.error('[enlasync] backup-override error:', err)
      sendResponse({ success: false, error: err.message })
    })
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
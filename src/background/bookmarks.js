export const ROOT_TITLE = '[SyncBookmarks]'
export const BACKUP_ROOT_TITLE = '[SyncBookmarksBackup]'

export async function findKeyForNode(nodeId) {
  let currentId = nodeId
  const visited = new Set()
  let depth = 0
  const MAX_DEPTH = 50

  while (currentId && depth < MAX_DEPTH) {
    if (visited.has(currentId)) return null
    visited.add(currentId)
    depth++

    let node
    try {
      ;[node] = await chrome.bookmarks.get(currentId)
    } catch {
      return null
    }

    if (!node.parentId || node.parentId === '0') return null

    let parent
    try {
      ;[parent] = await chrome.bookmarks.get(node.parentId)
    } catch {
      return null
    }

    if (parent.title === ROOT_TITLE && !parent.url) {
      return node.title
    }

    currentId = node.parentId
  }

  return null
}

export async function serializeTree(nodeId) {
  const [node] = await chrome.bookmarks.getSubTree(nodeId)
  return serializeNode(node)
}

function serializeNode(node) {
  const result = { title: node.title }
  if (node.url) {
    result.url = node.url
  }
  if (node.children) {
    result.children = node.children.map(serializeNode)
  }
  return result
}

async function ensureRootFolder() {
  const results = await chrome.bookmarks.search({ title: ROOT_TITLE })
  const folder = results.find((r) => !r.url)
  if (folder) return folder

  return chrome.bookmarks.create({ parentId: '1', title: ROOT_TITLE })
}

export async function ensureBackupFolder() {
  const results = await chrome.bookmarks.search({ title: BACKUP_ROOT_TITLE })
  const folder = results.find((r) => !r.url)
  if (folder) return folder

  return chrome.bookmarks.create({ parentId: '1', title: BACKUP_ROOT_TITLE })
}

export async function copyTreeToBackup(sourceFolderId, backupParentId) {
  const tree = await serializeTree(sourceFolderId)
  return copyNodeToBackup(tree, backupParentId)
}

export async function copyChildrenToBackup(sourceFolderId, backupParentId) {
  const children = await chrome.bookmarks.getChildren(sourceFolderId)
  let count = 0
  for (const child of children) {
    // Use getSubTree to get the complete subtree for each child
    const [subtree] = await chrome.bookmarks.getSubTree(child.id)
    const serialized = serializeNode(subtree)
    count += await copyNodeToBackup(serialized, backupParentId)
  }
  return count
}

async function copyNodeToBackup(node, parentId) {
  let count = 0
  if (node.url) {
    // Bookmark node
    await chrome.bookmarks.create({
      parentId,
      title: node.title,
      url: node.url,
    })
    count = 1
  } else {
    // Folder node
    const created = await chrome.bookmarks.create({
      parentId,
      title: node.title,
    })
    count = 1
    if (node.children) {
      for (const child of node.children) {
        count += await copyNodeToBackup(child, created.id)
      }
    }
  }
  return count
}

async function findRootFolder() {
  const results = await chrome.bookmarks.search({ title: ROOT_TITLE })
  return results.find((r) => !r.url) || null
}

export async function initializeBackupIfNeeded() {
  const stored = await chrome.storage.local.get('backup_initialized')
  if (stored.backup_initialized) {
    return
  }

  const root = await findRootFolder()
  if (!root) {
    console.warn('[enlasync] initializeBackupIfNeeded: [SyncBookmarks] root not found, skipping backup initialization')
    return
  }

  const backupRoot = await ensureBackupFolder()
  if (!backupRoot) {
    console.warn('[enlasync] initializeBackupIfNeeded: [SyncBookmarksBackup] root not found, skipping backup initialization')
    return
  }

  const rootChildren = await chrome.bookmarks.getChildren(root.id)
  let totalCount = 0
  for (const child of rootChildren) {
    if (!child.url) {
      totalCount += await copyTreeToBackup(child.id, backupRoot.id)
    }
  }

  await chrome.storage.local.set({ backup_initialized: true })
  console.log(`[enlasync] Backup initialized: ${totalCount} items copied to [SyncBookmarksBackup]`)
}

export async function findSyncFolder(syncKey) {
  const root = await ensureRootFolder()
  const children = await chrome.bookmarks.getChildren(root.id)
  const existing = children.find((c) => !c.url && c.title === syncKey)
  if (existing) return existing

  return chrome.bookmarks.create({
    parentId: root.id,
    title: syncKey,
  })
}

export async function applyDiff(localParentId, remoteChildren) {
  let localChildren
  try {
    localChildren = await chrome.bookmarks.getChildren(localParentId)
  } catch (err) {
    console.error('[enlasync] applyDiff getChildren error:', err)
    return
  }

  for (const remote of remoteChildren) {
    const isBookmark = !!remote.url
    const localMatch = isBookmark
      ? localChildren.find((l) => l.url === remote.url)
      : localChildren.find((l) => !l.url && l.title === remote.title)

    if (!localMatch) {
      let created
      try {
        created = await chrome.bookmarks.create({
          parentId: localParentId,
          title: remote.title,
          ...(isBookmark ? { url: remote.url } : {}),
        })
      } catch (err) {
        console.error('[enlasync] applyDiff error:', err)
        continue
      }
      if (!isBookmark && remote.children) {
        try {
          await applyDiff(created.id, remote.children)
        } catch (err) {
          console.error('[enlasync] applyDiff error:', err)
        }
      }
    } else {
      if (localMatch.title !== remote.title) {
        try {
          await chrome.bookmarks.update(localMatch.id, { title: remote.title })
        } catch (err) {
          console.error('[enlasync] applyDiff error:', err)
        }
      }
      if (!isBookmark && remote.children) {
        try {
          await applyDiff(localMatch.id, remote.children)
        } catch (err) {
          console.error('[enlasync] applyDiff error:', err)
        }
      }
    }
  }

  for (const local of localChildren) {
    const isBookmark = !!local.url
    const inRemote = isBookmark
      ? remoteChildren.some((r) => r.url === local.url)
      : remoteChildren.some((r) => !r.url && r.title === local.title)

    if (!inRemote) {
      if (isBookmark) {
        try {
          await chrome.bookmarks.remove(local.id)
        } catch (err) {
          console.error('[enlasync] applyDiff error:', err)
        }
      } else {
        try {
          await chrome.bookmarks.removeTree(local.id)
        } catch (err) {
          console.error('[enlasync] applyDiff error:', err)
        }
      }
    }
  }
}

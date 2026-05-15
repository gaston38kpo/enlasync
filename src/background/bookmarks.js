export const ROOT_TITLE = '[SyncBookmarks]'

export async function findKeyForNode(nodeId) {
  let currentId = nodeId

  while (true) {
    const [node] = await chrome.bookmarks.get(currentId)

    if (!node.parentId || node.parentId === '0') return null

    const [parent] = await chrome.bookmarks.get(node.parentId)

    if (parent.title === ROOT_TITLE && !parent.url) {
      return node.title
    }

    currentId = node.parentId
  }
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
  const localChildren = await chrome.bookmarks.getChildren(localParentId)

  for (const remote of remoteChildren) {
    const isBookmark = !!remote.url
    const localMatch = isBookmark
      ? localChildren.find((l) => l.url === remote.url)
      : localChildren.find((l) => !l.url && l.title === remote.title)

    if (!localMatch) {
      const created = await chrome.bookmarks.create({
        parentId: localParentId,
        title: remote.title,
        ...(isBookmark ? { url: remote.url } : {}),
      })
      if (!isBookmark && remote.children) {
        await applyDiff(created.id, remote.children)
      }
    } else {
      if (localMatch.title !== remote.title) {
        await chrome.bookmarks.update(localMatch.id, { title: remote.title })
      }
      if (!isBookmark && remote.children) {
        await applyDiff(localMatch.id, remote.children)
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
        await chrome.bookmarks.remove(local.id)
      } else {
        await chrome.bookmarks.removeTree(local.id)
      }
    }
  }
}

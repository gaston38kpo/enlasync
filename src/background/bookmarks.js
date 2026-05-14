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

export async function findSyncFolder() {
  const results = await chrome.bookmarks.search({ title: '[SyncBookmarks]' })
  const folder = results.find((r) => !r.url)
  if (folder) return folder

  return chrome.bookmarks.create({
    parentId: '1',
    title: '[SyncBookmarks]',
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

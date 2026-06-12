## Exploration: backup-folder-override

### Current State

The EnlaSync extension manages bookmarks under a single root folder `[SyncBookmarks]` (defined as `ROOT_TITLE` in `src/background/bookmarks.js:1`). 

**Key Architecture:**
- `ensureRootFolder()` searches for or creates `[SyncBookmarks]` under the Bookmarks Bar (parentId: '1')
- `findSyncFolder(syncKey)` finds/creates subfolders under `[SyncBookmarks]` for each sync key
- `serializeTree(nodeId)` uses `chrome.bookmarks.getSubTree()` to recursively fetch a full bookmark tree, then serializes it to a plain object structure (`{ title, url?, children? }`)
- `applyDiff(localParentId, remoteChildren)` recursively diffs and applies changes between local and remote trees
- Message passing: background service worker (`service-worker.js`) listens on `chrome.runtime.onMessage` for types like `force-sync`, `remote-change`, `offscreen-ready`. Popup sends messages via `chrome.runtime.sendMessage()`

**No backup folder logic exists currently.**

### Affected Areas

- `src/background/bookmarks.js` — Add backup folder creation/copy logic (new `BACKUP_ROOT_TITLE = '[SyncBookmarksBackup]'` constant, `ensureBackupFolder()`, `copyTreeToBackup()` functions)
- `src/background/service-worker.js` — Add message handler for `backup-override` type, expose `forceBackupOverride(syncKey)` function
- `src/popup/App.jsx` — Add "Backup Override" button with confirmation dialog for each sync key
- Tests: `tests/unit/bookmarks.test.js` — Add tests for backup folder logic

### Approaches

#### 1. Recursive Tree Copy Using getSubTree + create (Recommended)
Use existing `serializeTree` to get full tree, then recursively create nodes in backup folder.

- **Pros:** Reuses existing serialization logic; simple and reliable; matches how `applyDiff` works
- **Cons:** Multiple round-trips to chrome.bookmarks API (one create per node)
- **Effort:** Medium

#### 2. Bulk Copy with chrome.bookmarks.create (Multiple in One Call)
Chrome API doesn't support bulk create — would still need individual calls.

- **Pros:** None over approach 1
- **Cons:** Same complexity, no API advantage
- **Effort:** Medium

#### 3. Use chrome.bookmarks.copy (Does Not Exist)
Chrome bookmarks API has no `copy` method — only `create`, `move`, `removeTree`.

- **Pros:** N/A
- **Cons:** Not possible
- **Effort:** N/A

### Recommendation

**Approach 1 (Recursive Tree Copy)** is the only viable option. Implementation plan:

1. **Add constant** `BACKUP_ROOT_TITLE = '[SyncBookmarksBackup]'` in `bookmarks.js`
2. **Add `ensureBackupFolder()`** — mirrors `ensureRootFolder()` but for backup title
3. **Add `copyTreeToBackup(sourceFolderId, backupParentId)`** — recursively copies a tree using `serializeTree` + `chrome.bookmarks.create` (bookmarks) / `chrome.bookmarks.create` (folders) + recurse
4. **Add `initializeBackupIfNeeded()`** — called on startup; checks if backup exists, if not creates it by copying entire `[SyncBookmarks]` tree
5. **Add `forceBackupOverride(syncKey)`** in `service-worker.js` — copies specific sync key folder to backup (manual override)
6. **Add message handler** for `backup-override` type in `service-worker.js`
7. **Add "Backup Now" button** in `App.jsx` per sync key with `confirm()` dialog before sending message

### Risks

- **API Rate Limits:** Recursive `create` calls for large bookmark trees could be slow; should add small delays or batch in chunks
- **Partial Failure:** If copy fails mid-tree, backup will be incomplete; need error handling and rollback logging
- **Storage Quota:** Backup doubles bookmark storage; monitor for quota issues
- **Concurrency:** Manual override could race with auto-sync; use `isApplyingRemote` flag pattern from existing code
- **First-Time Detection:** Need to distinguish "backup never created" vs "backup exists but empty" — use a storage flag or check folder children count

### Ready for Proposal

**Yes.** The exploration is complete. The orchestrator should proceed to the proposal phase with the above approach. Key decisions needed from user:
- Should backup be per-sync-key or entire `[SyncBookmarks]` tree? (Requirements say "parallel backup folder" — likely entire tree)
- Confirmation UI: simple `confirm()` dialog or custom modal?
- Should backup override replace existing backup content or merge? (Requirements say "copies current state... as a snapshot" — implies replace)
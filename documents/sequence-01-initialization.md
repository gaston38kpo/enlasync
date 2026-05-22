# Inicialización de la extensión

```mermaid
sequenceDiagram
    participant Browser as "Chrome (startup/install)"
    participant SW as "Service Worker"
    participant CS as "chrome.storage"
    participant BM as "bookmarks.js"
    participant CY as "crypto.js"
    participant SB as Supabase
    participant OFF as "Offscreen Page"

    Browser->>SW: onStartup / onInstalled
    SW->>CS: get(sync_keys, deviceId)
    CS-->>SW: stored values
    SW->>SW: generate/reuse deviceId
    SW->>SB: createSupabaseClient()
    SW->>OFF: chrome Offscreen createDocument()
    OFF->>SW: sendMessage(Offscreen-ready)
    SW->>SW: init() si keyStates vacío
    SW->>SW: Offscreen-config -> syncKeys, deviceId
    loop Por cada syncKey
        SW->>SB: fetchTree(syncKey)
        SB-->>SW: encrypted tree
        SW->>CY: safeDecrypt(tree, syncKey)
        CY-->>SW: decrypted tree
        SW->>BM: findSyncFolder(syncKey)
        BM->>Browser: chrome bookmarks search/Create
        Browser-->>BM: folder
        BM-->>SW: folder
        SW->>BM: applyDiff(folder.id, remoteTree.children)
        BM->>Browser: Create/update/remove bookmarks
    end
    SW->>OFF: sendMessage(Offscreen-config, syncKeys, deviceId)
    OFF->>SB: subscribe realtime channel por syncKey
```

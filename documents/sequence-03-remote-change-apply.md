# Cambio remoto → Aplicar localmente

```mermaid
sequenceDiagram
    participant SB as "Supabase Realtime"
    participant OFF as "Offscreen Page"
    participant CY as "crypto.js"
    participant SW as "Service Worker"
    participant BM as "bookmarks.js"
    participant CB as "Chrome Bookmarks API"

    SB->>OFF: postgres_changes event (INSERT/UPDATE)
    OFF->>OFF: comprobar updated_by != deviceId
    OFF->>CY: safeDecrypt(tree, syncKey)
    CY-->>OFF: decrypted tree
    OFF->>SW: sendMessage(remote-change, syncKey, tree)
    SW->>SW: isApplyingRemote = true
    SW->>BM: findSyncFolder(syncKey)
    BM-->>SW: folder
    SW->>BM: applyDiff(folder.id, tree.children)
    loop Por cada nodo remoto
        BM->>CB: chrome bookmarks Create/update (si falta o difiere)
    end
    loop Por cada nodo local
        BM->>CB: chrome.bookmarks.remove/removeTree (si no está en remoto)
    end
    SW->>SW: isApplyingRemote = false
    Note over SW: isApplyingRemote evita re-push de cambios remotos
```

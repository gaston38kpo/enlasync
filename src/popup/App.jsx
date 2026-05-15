import React, { useState, useEffect } from 'react'
import './App.css'

export async function saveSyncKeys(keys) {
  const normalized = keys.filter(Boolean).map((k) => k.trim()).filter(Boolean)
  await chrome.storage.local.set({ sync_keys: [...new Set(normalized)] })
  chrome.runtime.reload()
}

export default function App() {
  const [syncKeys, setSyncKeys] = useState([])
  const [newKey, setNewKey] = useState('')
  const [syncingKeys, setSyncingKeys] = useState(new Set())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(['sync_keys', 'sync_key']).then((stored) => {
      if (stored.sync_keys && Array.isArray(stored.sync_keys)) {
        setSyncKeys(stored.sync_keys)
      } else if (stored.sync_key) {
        setSyncKeys([stored.sync_key])
      }
      setLoaded(true)
    })
  }, [])

  const handleAdd = () => {
    const trimmed = newKey.trim()
    if (!trimmed || syncKeys.includes(trimmed)) return
    const updated = [...syncKeys, trimmed]
    setSyncKeys(updated)
    setNewKey('')
  }

  const handleRemove = (key) => {
    const updated = syncKeys.filter((k) => k !== key)
    setSyncKeys(updated)
  }

  const handleSave = () => saveSyncKeys(syncKeys)

  const handleForceSync = async (key) => {
    if (syncingKeys.has(key)) return
    setSyncingKeys((prev) => new Set(prev).add(key))
    try {
      await chrome.runtime.sendMessage({ type: 'force-sync', syncKey: key })
    } catch {
      await chrome.runtime.sendMessage({ type: 'force-sync', syncKey: key })
    }
    setSyncingKeys((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const handleForceSyncAll = async () => {
    if (syncingKeys.size > 0) return
    const allKeys = syncKeys.map((key) => {
      setSyncingKeys((prev) => new Set(prev).add(key))
      return key
    })
    try {
      await chrome.runtime.sendMessage({ type: 'force-sync' })
    } catch {
      await chrome.runtime.sendMessage({ type: 'force-sync' })
    }
    setSyncingKeys(new Set())
  }

  if (!loaded) return null

  return (
    <div className="popup">
      <h1>EnlaSync</h1>

      <div className="key-list">
        {syncKeys.length === 0 && (
          <p className="empty-state">No sync keys added yet</p>
        )}
        {syncKeys.map((key) => (
          <div key={key} className="key-item">
            <span className="key-name" title={key}>{key}</span>
            <button
              className="btn-icon"
              onClick={() => handleForceSync(key)}
              disabled={syncingKeys.has(key)}
              title="Sync now"
            >
              {syncingKeys.has(key) ? '⟳' : '↻'}
            </button>
            <button
              className="btn-icon btn-remove"
              onClick={() => handleRemove(key)}
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="key-add">
        <input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="Enter sync key"
        />
        <button onClick={handleAdd} disabled={!newKey.trim() || syncKeys.includes(newKey.trim())}>
          Add
        </button>
      </div>

      <button className="btn-save" onClick={handleSave}>
        Save
      </button>

      {syncKeys.length > 1 && (
        <button
          className="force-sync"
          onClick={handleForceSyncAll}
          disabled={syncingKeys.size > 0}
        >
          Sync All
        </button>
      )}
    </div>
  )
}
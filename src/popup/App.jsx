import React, { useState, useEffect } from 'react'
import './App.css'

export async function saveSyncKey(syncKey) {
  await chrome.storage.local.set({ sync_key: syncKey })
  chrome.runtime.reload()
}

export default function App() {
  const [syncKey, setSyncKey] = useState('')

  useEffect(() => {
    chrome.storage.local.get(['sync_key']).then((stored) => {
      if (stored.sync_key) setSyncKey(stored.sync_key)
    })
  }, [])

  const handleSave = () => saveSyncKey(syncKey)

  return (
    <div className="popup">
      <h1>EnlaSync</h1>
      <label htmlFor="sync-key">Sync Key</label>
      <input
        id="sync-key"
        type="text"
        value={syncKey}
        onChange={(e) => setSyncKey(e.target.value)}
        placeholder="Enter sync key"
      />
      <button onClick={handleSave}>Save</button>
    </div>
  )
}

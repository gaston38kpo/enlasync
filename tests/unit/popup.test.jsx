import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { saveSyncKeys } from '@/popup/App.jsx'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import App from '@/popup/App.jsx'

describe('saveSyncKeys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chrome.storage.local.set = vi.fn().mockResolvedValue(undefined)
    chrome.storage.local.remove = vi.fn().mockResolvedValue(undefined)
    chrome.runtime.reload = vi.fn()
  })

  it('saves normalized sync_keys to storage and reloads runtime', async () => {
    await saveSyncKeys(['key-a', 'key-b'])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
    expect(chrome.storage.local.remove).toHaveBeenCalledWith('sync_key')
    expect(chrome.runtime.reload).toHaveBeenCalled()
  })

  it('deduplicates keys before saving', async () => {
    await saveSyncKeys(['key-a', 'key-b', 'key-a'])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
  })

  it('trims whitespace before saving', async () => {
    await saveSyncKeys(['  key-a  ', ' key-b'])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
  })

  it('removes empty strings before saving', async () => {
    await saveSyncKeys(['key-a', '', 'key-b', '  '])

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ sync_keys: ['key-a', 'key-b'] })
  })
})

describe('App component - backup override', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chrome.storage.local.get = vi.fn().mockResolvedValue({
      sync_keys: ['work', 'personal'],
    })
    chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ success: true, copied: 5 })
    window.confirm = vi.fn().mockReturnValue(true)
    window.alert = vi.fn()
  })

  it('renders Backup Now button for each sync key', async () => {
    render(<App />)

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      expect(backupButtons).toHaveLength(2)
      expect(document.body.contains(backupButtons[0])).toBe(true)
    })
  })

  it('shows confirmation dialog when Backup Now is clicked', async () => {
    render(<App />)

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      fireEvent.click(backupButtons[0])
    })

    expect(window.confirm).toHaveBeenCalledWith("Esto sobrescribirá el backup de 'work' con el estado actual. ¿Confirmar?")
  })

  it('does not send message when user cancels confirmation', async () => {
    window.confirm.mockReturnValueOnce(false)
    render(<App />)

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      fireEvent.click(backupButtons[0])
    })

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(window.alert).not.toHaveBeenCalled()
  })

  it('sends backup-override message and shows success alert on success', async () => {
    render(<App />)

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      fireEvent.click(backupButtons[0])
    })

    await waitFor(() => {
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'backup-override',
        syncKey: 'work',
      })
    })

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("Backup de 'work' actualizado correctamente")
    })
  })

  it('shows error alert when backup-override fails', async () => {
    chrome.runtime.sendMessage.mockResolvedValueOnce({ success: false, error: 'Sync key folder not found' })
    render(<App />)

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      fireEvent.click(backupButtons[0])
    })

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("Error al actualizar backup: Sync key folder not found")
    })
  })

  it('disables Backup Now button while backing up', async () => {
    // Make the message take some time
    let resolveMessage
    chrome.runtime.sendMessage.mockImplementationOnce(() => new Promise((resolve) => {
      resolveMessage = resolve
    }))
    
    render(<App />)

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      expect(backupButtons[0].hasAttribute('disabled')).toBe(false)
      fireEvent.click(backupButtons[0])
    })

    // Button should be disabled while backing up
    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      expect(backupButtons[0].hasAttribute('disabled')).toBe(true)
    })

    // Resolve and check button is enabled again
    resolveMessage({ success: true, copied: 5 })
    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      expect(backupButtons[0].hasAttribute('disabled')).toBe(false)
    })
  })

  it('disables Backup Now button when syncing', async () => {
    render(<App />)

    await waitFor(() => {
      const syncButtons = screen.getAllByTitle('Sync now')
      fireEvent.click(syncButtons[0])
    })

    await waitFor(() => {
      const backupButtons = screen.getAllByTitle('Crear snapshot de backup')
      expect(backupButtons[0].hasAttribute('disabled')).toBe(true)
    })
  })
})
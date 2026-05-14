import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const manifestSource = readFileSync(
  resolve(process.cwd(), 'manifest.config.js'),
  'utf-8'
)

describe('manifest permissions', () => {
  it('includes bookmarks permission', () => {
    expect(manifestSource).toContain("'bookmarks'")
  })

  it('includes storage permission', () => {
    expect(manifestSource).toContain("'storage'")
  })

  it('includes supabase host_permissions', () => {
    expect(manifestSource).toContain('supabase.co')
  })
})

import { describe, it, expect } from 'vitest'

describe('test infrastructure smoke', () => {
  it('runs inside a jsdom environment', () => {
    expect(typeof document).not.toBe('undefined')
  })

  it('exposes mocked chrome.bookmarks', () => {
    expect(typeof chrome.bookmarks).not.toBe('undefined')
  })

  it('exposes a callable chrome.bookmarks.create mock', () => {
    expect(typeof chrome.bookmarks.create).toBe('function')
    expect(() => chrome.bookmarks.create({ title: 'test', url: 'https://test.com', parentId: '1' })).not.toThrow()
  })
})

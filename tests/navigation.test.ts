import { describe, expect, test } from 'bun:test'
import { isPrimaryNavigationClick, isPlatformPrimaryModifier } from '../src/navigation'

describe('navigation modifiers', () => {
  const click = {
    button: 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }

  test('uses the platform primary modifier for navigation clicks', () => {
    expect(isPrimaryNavigationClick('MacIntel', click)).toBe(false)
    expect(isPrimaryNavigationClick('MacIntel', { ...click, metaKey: true })).toBe(true)
    expect(isPrimaryNavigationClick('MacIntel', { ...click, ctrlKey: true })).toBe(false)
    expect(isPrimaryNavigationClick('Linux x86_64', { ...click, ctrlKey: true })).toBe(true)
    expect(isPrimaryNavigationClick('Win32', { ...click, metaKey: true })).toBe(false)
    expect(isPrimaryNavigationClick('Linux x86_64', {
      ...click,
      ctrlKey: true,
      metaKey: true,
    })).toBe(false)
    expect(isPrimaryNavigationClick('Linux x86_64', {
      ...click,
      altKey: true,
      ctrlKey: true,
    })).toBe(false)
    expect(isPrimaryNavigationClick('MacIntel', {
      ...click,
      metaKey: true,
      shiftKey: true,
    })).toBe(false)
    expect(isPrimaryNavigationClick('Linux x86_64', {
      ...click,
      button: 1,
      ctrlKey: true,
    })).toBe(false)
  })

  test('shares the same modifier policy with hover previews', () => {
    expect(isPlatformPrimaryModifier('MacIntel', { ...click, metaKey: true })).toBe(true)
    expect(isPlatformPrimaryModifier('Linux x86_64', { ...click, ctrlKey: true })).toBe(true)
  })
})

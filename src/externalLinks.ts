import type { MouseClickModifiers } from './clickModifiers'

export function isExternalLinkNavigationClick(modifiers: MouseClickModifiers) {
  return modifiers.button === 0
    && modifiers.ctrlKey
    && !modifiers.altKey
    && !modifiers.metaKey
    && !modifiers.shiftKey
}

export function externalUrlFromText(text: string) {
  const trimmed = text.trim()
  const candidate = /^www\./iu.test(trimmed) ? `https://${trimmed}` : trimmed

  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? candidate : null
  } catch {
    return null
  }
}

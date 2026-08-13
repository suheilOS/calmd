export type PrimaryModifierState = {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

export type PrimaryNavigationClick = PrimaryModifierState & {
  button: number
}

export function navigationPlatform() {
  const navigatorWithUserAgentData = navigator as Navigator & {
    userAgentData?: { platform?: string }
  }
  return navigatorWithUserAgentData.userAgentData?.platform
    || navigator.platform
    || navigator.userAgent
}

export function isPlatformPrimaryModifier(
  platform: string,
  modifiers: PrimaryModifierState,
) {
  if (modifiers.altKey || modifiers.shiftKey) return false
  return /Mac/i.test(platform)
    ? modifiers.metaKey && !modifiers.ctrlKey
    : modifiers.ctrlKey && !modifiers.metaKey
}

export function isPrimaryNavigationClick(
  platform: string,
  click: PrimaryNavigationClick,
) {
  return click.button === 0 && isPlatformPrimaryModifier(platform, click)
}

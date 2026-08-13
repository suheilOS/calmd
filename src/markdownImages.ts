export const SUPPORTED_IMAGE_EXTENSIONS = ['gif', 'jpeg', 'jpg', 'png', 'webp'] as const

export type LocalImageDestination = {
  destination: string
  extension: (typeof SUPPORTED_IMAGE_EXTENSIONS)[number]
}

export type InlineImageSyntax = {
  alt: string
  destination: string
  title?: string
}

type SupportedImageExtension = LocalImageDestination['extension']

type SyntaxRange = {
  name: string
  from: number
  to: number
}

const URI_SCHEME = /^[a-z][a-z\d+.-]*:/iu
const WINDOWS_DRIVE = /^[a-z]:/iu
const MARKDOWN_DESTINATION_ESCAPE = /([\\)])/gu
const MARKDOWN_ALT_ESCAPE = /([\\[\]])/gu

function unescapeMarkdown(value: string) {
  return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, '$1')
}

function isSupportedImageExtension(value: string): value is SupportedImageExtension {
  return SUPPORTED_IMAGE_EXTENSIONS.some((extension) => extension === value)
}

export function classifyLocalImageDestination(
  rawDestination: string,
): LocalImageDestination | null {
  const bracketed = rawDestination.startsWith('<') && rawDestination.endsWith('>')
  const destination = unescapeMarkdown(
    bracketed ? rawDestination.slice(1, -1) : rawDestination,
  )

  if (
    destination.length === 0
    || destination !== destination.trim()
    || destination.includes('\\')
    || destination.includes('?')
    || destination.includes('#')
    || destination.startsWith('/')
    || WINDOWS_DRIVE.test(destination)
    || URI_SCHEME.test(destination)
  ) {
    return null
  }

  const segments = destination.split('/')
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null
  }

  const extension = segments.at(-1)?.split('.').at(-1)?.toLocaleLowerCase('en-US') ?? ''
  if (!isSupportedImageExtension(extension)) return null

  return { destination, extension }
}

export function parseInlineImageSyntax(
  source: string,
  children: readonly SyntaxRange[],
  sourceOffset = 0,
): InlineImageSyntax | null {
  const marks = children.filter((child) => child.name === 'LinkMark')
  const destination = children.find((child) => child.name === 'URL')
  if (marks.length < 4 || !destination || children.some((child) => child.name === 'LinkLabel')) {
    return null
  }

  const altFrom = marks[0].to - sourceOffset
  const altTo = marks[1].from - sourceOffset
  const title = children.find((child) => child.name === 'LinkTitle')
  const unwrapTitle = (value: string) => value.length >= 2 ? value.slice(1, -1) : value

  return {
    alt: unescapeMarkdown(source.slice(altFrom, altTo)),
    destination: source.slice(
      destination.from - sourceOffset,
      destination.to - sourceOffset,
    ),
    ...(title ? {
      title: unescapeMarkdown(unwrapTitle(source.slice(
        title.from - sourceOffset,
        title.to - sourceOffset,
      ))),
    } : {}),
  }
}

export function formatMarkdownImageDestination(destination: string) {
  if (/[\s()<>]/u.test(destination)) {
    return `<${destination.replace(/([\\<>])/gu, '\\$1')}>`
  }
  return destination.replace(MARKDOWN_DESTINATION_ESCAPE, '\\$1')
}

export function markdownImage(destination: string, alt = '') {
  const escapedAlt = alt.replace(MARKDOWN_ALT_ESCAPE, '\\$1')
  return `![${escapedAlt}](${formatMarkdownImageDestination(destination)})`
}

import type { DisplayImage } from '../images'
import type { NoteReference } from '../notes'
import type { NotePreviewCandidate } from '../notePreview'
import type { MarkdownBlockKind } from './markdownBlockCommands'

export type MarkdownInlineFormat =
  | 'bold'
  | 'italic'
  | 'highlight'
  | 'link'
  | 'code'
  | 'strikethrough'

export type MarkdownFormatState = 'active' | 'inactive' | 'mixed' | 'unavailable'

export type FormattingToolbarSnapshot = {
  anchor: {
    height: number
    width: number
    x: number
    y: number
  }
  blockKind: MarkdownBlockKind | 'mixed'
  formats: Record<MarkdownInlineFormat, MarkdownFormatState>
  selectionRevision: number
}

export type WikiLinkActivation = {
  target: string
  validateCurrentOccurrence: (authoritativeBody: string) => boolean
  applyCanonical: (canonicalTarget: string, resolvedTitle: string) => string | null
  finish: () => void
}

export type MarkdownEditorCommands = {
  applyBlock: (kind: MarkdownBlockKind) => void
  focus: () => void
  focusAtEnd: () => void
  insertImage: () => void
  toggleInline: (format: MarkdownInlineFormat) => void
}

export type MarkdownEditorInput = {
  editorSessionId: number
  noteKey: string
  value: string
  onChange: (value: string) => void
  onPreviewCandidateEnter: (candidate: NotePreviewCandidate) => void
  onPreviewCandidateLeave: () => void
  onPreviewDismiss: () => void
  onExternalLinkError?: (error: unknown) => void
  onImageError?: (error: unknown) => void
  onWikiLinkActivate: (activation: WikiLinkActivation) => void
  resolveImage?: (destination: string) => Promise<DisplayImage>
  resolveWikiLink: (target: string) => Promise<boolean | null>
  spellcheckEnabled: boolean
  suggestWikiLinks: (query: string) => Promise<NoteReference[]>
}

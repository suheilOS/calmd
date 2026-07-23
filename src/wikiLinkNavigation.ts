import type { WikiLinkActivation } from './MarkdownEditor'
import type { NoteEditingSnapshot } from './noteEditing'
import type { Note, OpenNoteLinkResponse } from './notes'

type WikiLinkNavigation = {
  activatedKey: string
  activation: WikiLinkActivation
  flush: () => Promise<NoteEditingSnapshot | null>
  open: (target: string) => Promise<OpenNoteLinkResponse>
  updateBody: (body: string) => void
  isCurrent: () => boolean
}

export async function resolveWikiLinkActivation({
  activatedKey,
  activation,
  flush,
  open,
  updateBody,
  isCurrent,
}: WikiLinkNavigation): Promise<Note | null> {
  const flushed = await flush()
  if (!flushed || !isCurrent() || flushed.key !== activatedKey) return null
  if (!activation.validateCurrentOccurrence(flushed.draft.body)) return null

  const resolved = await open(activation.target)
  if (!isCurrent()) return null
  const rewrittenBody = activation.applyCanonical(
    resolved.canonicalTarget,
    resolved.note.title,
  )
  if (rewrittenBody === null) return null
  updateBody(rewrittenBody)

  const canonicalFlush = await flush()
  if (!canonicalFlush || !isCurrent()) return null
  return canonicalFlush.key === resolved.note.key ? null : resolved.note
}

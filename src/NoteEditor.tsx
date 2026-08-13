import { Button } from '@base-ui/react/button'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BacklinksPopover } from './BacklinksPopover'
import { EditorContextMenu } from './EditorContextMenu'
import { NotePreviewPopover } from './NotePreviewPopover'
import type { MarkdownEditorHandle, WikiLinkActivation } from './MarkdownEditor'
import { handleTitleKeyDown } from './titleKeyDown'
import {
  constrainNoteTitle,
  MAX_NOTE_TITLE_LENGTH,
  type NoteReference,
  type NoteDraft,
} from './notes'
import {
  NotePreviewController,
  type NotePreviewCandidate,
  type NotePreviewLoadResult,
} from './notePreview'
import {
  getStorageError,
  readStoredNotePreview,
  resolveStoredNotePreview,
} from './storage'

const MarkdownEditor = lazy(async () => {
  const module = await import('./MarkdownEditor')
  return { default: module.MarkdownEditor }
})

async function loadNotePreview(
  candidate: NotePreviewCandidate,
): Promise<NotePreviewLoadResult> {
  try {
    const preview = candidate.source === 'wiki-link'
      ? await resolveStoredNotePreview(candidate.target)
      : await readStoredNotePreview(candidate.key)
    return preview ? { kind: 'found', preview } : { kind: 'missing' }
  } catch (reason) {
    const error = getStorageError(reason)
    return error.code === 'not_found' || error.code === 'invalid_link'
      ? { kind: 'missing' }
      : { kind: 'error', message: error.message }
  }
}

type NoteEditorProps = {
  draft: NoteDraft
  editorSessionId: number
  spellcheckEnabled: boolean
  noteKey: string
  backlinksOpen: boolean
  onDraftChange: (draft: NoteDraft) => void
  onBacklinksOpenChange: (open: boolean) => void
  onConflictReload: (() => void) | null
  onExternalLinkError: (error: unknown) => void
  onSpellcheckEnabledChange: (enabled: boolean) => void
  onWikiLinkActivate: (activation: WikiLinkActivation) => void
  onBacklinkSelect: (key: string) => void
  resolveWikiLink: (target: string) => Promise<boolean | null>
  suggestWikiLinks: (query: string) => Promise<NoteReference[]>
  saveMessage: string | null
}

export function NoteEditor({
  draft,
  editorSessionId,
  spellcheckEnabled,
  noteKey,
  backlinksOpen,
  onDraftChange,
  onBacklinksOpenChange,
  onConflictReload,
  onExternalLinkError,
  onSpellcheckEnabledChange,
  onWikiLinkActivate,
  onBacklinkSelect,
  resolveWikiLink,
  suggestWikiLinks,
  saveMessage,
}: NoteEditorProps) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyEditorRef = useRef<MarkdownEditorHandle>(null)
  const titleSelectionRef = useRef({ start: 0, end: 0 })
  const [previewController] = useState(() => new NotePreviewController(loadNotePreview))

  useEffect(() => () => previewController.dispose(), [previewController])

  useLayoutEffect(() => {
    const title = titleRef.current
    if (!title || document.activeElement !== title) return
    const { start, end } = titleSelectionRef.current
    title.setSelectionRange(
      Math.min(start, draft.title.length),
      Math.min(end, draft.title.length),
    )
  }, [draft.title])

  return (
    <main className="app bg-canvas text-ink">
      <article className="note-editor-page mx-auto w-full max-w-[65ch] px-6 pb-24 pt-[15vh] sm:px-8">
        <div className="flex items-start gap-2">
          <label className="sr-only" htmlFor="note-title">Note title</label>
          <textarea
          aria-label="Note title"
          autoComplete="off"
          className="block min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-large text-ink outline-none break-words placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint [field-sizing:content]"
          id="note-title"
          maxLength={MAX_NOTE_TITLE_LENGTH}
          name="title"
          onChange={(event) => {
            titleSelectionRef.current = {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            }
            onDraftChange({
              ...draft,
              title: constrainNoteTitle(event.target.value),
            })
          }}
          onKeyDown={(event) => handleTitleKeyDown({
            key: event.key,
            isComposing: event.nativeEvent.isComposing,
            preventDefault: () => event.preventDefault(),
          }, bodyEditorRef.current)}
          onSelect={(event) => {
            titleSelectionRef.current = {
              start: event.currentTarget.selectionStart,
              end: event.currentTarget.selectionEnd,
            }
          }}
          ref={titleRef}
          rows={1}
          value={draft.title}
          />
          <EditorContextMenu
            onBlockChange={(kind) => bodyEditorRef.current?.applyBlock(kind)}
            onInsertImage={() => bodyEditorRef.current?.insertImage()}
            onSpellcheckChange={onSpellcheckEnabledChange}
            spellcheckEnabled={spellcheckEnabled}
          />
        </div>
        <div className="mt-6 sm:mt-8">
          <Suspense fallback={<div aria-hidden="true" className="min-h-[58vh]" />}>
            <MarkdownEditor
              editorSessionId={editorSessionId}
              noteKey={noteKey}
              ref={bodyEditorRef}
              onChange={(body) => onDraftChange({ ...draft, body })}
              onPreviewCandidateEnter={previewController.enterSource}
              onPreviewCandidateLeave={previewController.leaveSource}
              onPreviewDismiss={previewController.dismiss}
              onExternalLinkError={onExternalLinkError}
              onImageError={onExternalLinkError}
              onWikiLinkActivate={onWikiLinkActivate}
              resolveWikiLink={resolveWikiLink}
              spellcheckEnabled={spellcheckEnabled}
              suggestWikiLinks={suggestWikiLinks}
              value={draft.body}
            />
          </Suspense>
        </div>
      </article>

      <BacklinksPopover
        noteKey={noteKey}
        onOpenChange={(open) => {
          if (!open) previewController.dismiss()
          onBacklinksOpenChange(open)
        }}
        onPreviewCandidateEnter={previewController.enterSource}
        onPreviewCandidateLeave={previewController.leaveSource}
        onPreviewDismiss={previewController.dismiss}
        onSelect={onBacklinkSelect}
        open={backlinksOpen}
      />

      <NotePreviewPopover
        controller={previewController}
        currentDraft={draft}
        currentNoteKey={noteKey}
      />

      {saveMessage ? (
        <div className="fixed inset-x-16 bottom-6 flex items-center justify-center gap-3 text-small text-secondary" role="alert">
          <span>{saveMessage}</span>
          {onConflictReload ? (
            <Button
              className="min-h-10 rounded-xl bg-surface px-3 text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-hover focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96]"
              onClick={onConflictReload}
              type="button"
            >
              Reload from disk
            </Button>
          ) : null}
        </div>
      ) : null}
    </main>
  )
}

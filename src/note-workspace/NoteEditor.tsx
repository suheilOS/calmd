import { Button } from '@base-ui/react/button'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BacklinksPopover } from '../BacklinksPopover'
import type { MarkdownEditorCommands } from '../markdown-editor/contracts'
import { NotePreviewPopover } from '../NotePreviewPopover'
import { handleTitleKeyDown } from '../titleKeyDown'
import { useEditorChrome } from './editorChromeContext'
import {
  constrainNoteTitle,
  MAX_NOTE_TITLE_LENGTH,
} from '../notes'
import {
  NotePreviewController,
  type NotePreviewCandidate,
  type NotePreviewLoadResult,
} from '../notePreview'
import {
  getStorageError,
  readStoredNotePreview,
  resolveStoredNotePreview,
} from '../storage'
import { useNoteWorkspace } from './context'

const MarkdownEditor = lazy(async () => {
  const module = await import('../markdown-editor/MarkdownEditor')
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

export function NoteEditor() {
  const { actions, meta, state } = useNoteWorkspace()
  const { registerInsertImage } = useEditorChrome()
  if (!state.note) {
    throw new Error('NoteWorkspace.Editor requires an active Note.')
  }
  const { draft, key: noteKey } = state.note
  const saveMessage = state.note.failure?.message ?? state.message ?? meta.externalMessage
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyEditorRef = useRef<MarkdownEditorCommands>(null)
  const titleSelectionRef = useRef({ start: 0, end: 0 })
  const [previewController] = useState(() => new NotePreviewController(loadNotePreview))

  const setBodyEditor = useCallback((commands: MarkdownEditorCommands | null) => {
    bodyEditorRef.current = commands
    registerInsertImage(commands ? commands.insertImage : null)
  }, [registerInsertImage])

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
        <label className="sr-only" htmlFor="note-title">Note title</label>
        <textarea
          aria-label="Note title"
          autoComplete="off"
          className="block min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-large text-ink outline-none break-words placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-faint [field-sizing:content]"
          id="note-title"
          dir="auto"
          maxLength={MAX_NOTE_TITLE_LENGTH}
          name="title"
          onChange={(event) => {
            titleSelectionRef.current = {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            }
            actions.updateDraft({
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
        <div className="mt-6 sm:mt-8">
          <Suspense fallback={<div aria-hidden="true" className="min-h-[58vh]" />}>
            <MarkdownEditor
              editorSessionId={state.editorSessionId}
              noteKey={noteKey}
              ref={setBodyEditor}
              onChange={(body) => actions.updateDraft({ ...draft, body })}
              onPreviewCandidateEnter={previewController.enterSource}
              onPreviewCandidateLeave={previewController.leaveSource}
              onPreviewDismiss={previewController.dismiss}
              onExternalLinkError={actions.reportError}
              onImageError={actions.reportError}
              onWikiLinkActivate={(activation) => void actions.activateWikiLink(activation)}
              resolveWikiLink={meta.resolveWikiLink}
              spellcheckEnabled={meta.spellcheckEnabled}
              suggestWikiLinks={meta.suggestWikiLinks}
              value={draft.body}
            />
          </Suspense>
        </div>
      </article>

      <BacklinksPopover
        noteKey={noteKey}
        onOpenChange={(open) => {
          if (!open) previewController.dismiss()
          actions.setBacklinksOpen(open)
        }}
        onPreviewCandidateEnter={previewController.enterSource}
        onPreviewCandidateLeave={previewController.leaveSource}
        onPreviewDismiss={previewController.dismiss}
        onSelect={(key) => void actions.open(key)}
        open={state.backlinksOpen}
      />

      <NotePreviewPopover
        controller={previewController}
        currentDraft={draft}
        currentNoteKey={noteKey}
      />

      {saveMessage ? (
        <div className="fixed inset-x-16 bottom-6 flex items-center justify-center gap-3 text-small text-secondary" role="alert">
          <bdi dir="auto">{saveMessage}</bdi>
          {state.note.conflict ? (
            <Button
              className="min-h-10 rounded-xl bg-surface px-3 text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-hover focus-visible:bg-active focus-visible:text-active-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96]"
              onClick={() => void actions.reload()}
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

import { Button } from '@base-ui/react/button'
import { Dialog } from '@base-ui/react/dialog'
import { Input } from '@base-ui/react/input'
import { Menu } from '@base-ui/react/menu'
import { useEffect, useState } from 'react'
import { NoteActions } from './NoteActions'
import {
  getStorageError,
  readStoredSubstackPublicationUrl,
  saveStoredSubstackPublicationUrl,
} from '../storage'
import { openNoteInSubstack } from '../substack'
import { useNoteWorkspace } from './context'
import { useEditorChrome } from './editorChromeContext'

type SubstackSettingsDialogProps = {
  message: string | null
  onOpenChange: (open: boolean) => void
  onSave: (url: string) => void
  open: boolean
  publicationUrl: string | null
  saving: boolean
}

function SubstackIcon() {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
      <path d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.54 24V10.812H1.46zM22.54 0H1.46v2.836h21.08V0z" />
    </svg>
  )
}

function EditorActionIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" viewBox="0 0 16 16">
      {children}
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" className="size-4 shrink-0" fill="none" viewBox="0 0 24 24">
      <path d="M16.4326 2.25H6.56739C5.61495 2.24999 4.85439 2.24999 4.24013 2.30018C3.61012 2.35165 3.06824 2.45963 2.57054 2.71322C1.77085 3.12068 1.12068 3.77085 0.713223 4.57054C0.459634 5.06824 0.35165 5.61012 0.300176 6.24013C0.249989 6.85439 0.249994 7.61494 0.25 8.56738V14.4326C0.249994 15.3851 0.249989 16.1456 0.300176 16.7599C0.35165 17.3899 0.459634 17.9318 0.713223 18.4295C1.09522 19.1792 1.69053 19.7975 2.42237 20.2076C2.47116 20.2349 2.52056 20.2613 2.57054 20.2868C3.06824 20.5404 3.61033 20.6485 4.24034 20.6999C4.85459 20.7501 5.61511 20.7501 6.56751 20.7501H12.9652C13.0072 20.7501 13.0487 20.7466 13.0894 20.7398C13.1841 20.724 13.2728 20.6905 13.3519 20.6428C13.4176 20.6033 13.4775 20.5535 13.5291 20.4947C13.5538 20.4664 13.5763 20.4366 13.5963 20.4054C13.6597 20.3069 13.7007 20.1926 13.712 20.0697C13.7157 20.03 13.7163 19.9899 13.7135 19.9497C13.7123 19.9303 13.7102 19.9111 13.7075 19.8921C13.6696 19.6004 13.65 19.3027 13.65 19C13.65 15.6625 16.0376 12.8811 19.1982 12.2734C19.4708 12.221 19.6922 12.0223 19.7736 11.7569C19.855 11.4915 19.7832 11.2029 19.5869 11.0066L17.2375 8.65709C16.5541 7.97369 15.446 7.97368 14.7626 8.65707L8.99932 14.4201L7.75668 13.1772C7.07325 12.4936 5.96501 12.4935 5.28155 13.1771L1.79722 16.662L1.79519 16.6377C1.75058 16.0917 1.75 15.3925 1.75 14.4V8.6C1.75 7.60753 1.75058 6.90829 1.79519 6.36228C1.83909 5.82503 1.92184 5.50252 2.04973 5.25153C2.31338 4.73408 2.73408 4.31338 3.25153 4.04973C3.50252 3.92184 3.82503 3.83909 4.36228 3.79519C4.90829 3.75058 5.60753 3.75 6.6 3.75H16.4C17.3925 3.75 18.0917 3.75058 18.6377 3.79519C19.175 3.83909 19.4975 3.92184 19.7485 4.04973C20.2659 4.31338 20.6866 4.73408 20.9503 5.25153C21.0782 5.50252 21.1609 5.82503 21.2048 6.36228C21.2494 6.90829 21.25 7.60753 21.25 8.6V11.548C21.25 11.9622 21.5858 12.298 22 12.298C22.4142 12.298 22.75 11.9622 22.75 11.548V8.56737C22.75 7.61496 22.75 6.85438 22.6998 6.24013C22.6483 5.61012 22.5404 5.06824 22.2868 4.57054C21.8793 3.77085 21.2291 3.12068 20.4295 2.71322C19.9318 2.45963 19.3899 2.35165 18.7599 2.30018C18.1456 2.24999 17.3851 2.24999 16.4326 2.25Z" fill="currentColor" />
      <path d="M7 6.5C5.89543 6.5 5 7.39543 5 8.5C5 9.60457 5.89543 10.5 7 10.5C8.10457 10.5 9 9.60457 9 8.5C9 7.39543 8.10457 6.5 7 6.5Z" fill="currentColor" />
      <path d="M23.75 18C23.75 18.4142 23.4142 18.75 23 18.75H20.75V21C20.75 21.4142 20.4142 21.75 20 21.75C19.5858 21.75 19.25 21.4142 19.25 21V18.75H17C16.5858 18.75 16.25 18.4142 16.25 18C16.25 17.5858 16.5858 17.25 17 17.25H19.25V15C19.25 14.5858 19.5858 14.25 20 14.25C20.4142 14.25 20.75 14.5858 20.75 15V17.25H23C23.4142 17.25 23.75 17.5858 23.75 18Z" fill="currentColor" />
    </svg>
  )
}

function SpellcheckIcon() {
  return <EditorActionIcon><path d="m2.25 10 3-7 3 7M3.25 7.75h4M9.5 10.5l1.5 1.5 3-3.5" /></EditorActionIcon>
}

function CheckIcon() {
  return <EditorActionIcon><path d="m3.5 8 3 3 6-6" /></EditorActionIcon>
}

function SubstackSettingsDialog({
  message,
  onOpenChange,
  onSave,
  open,
  publicationUrl,
  saving,
}: SubstackSettingsDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!saving) onOpenChange(nextOpen)
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-150 ease-out data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <Dialog.Popup className="w-full max-w-sm rounded-2xl bg-surface p-6 text-ink shadow-[0_16px_48px_oklch(0_0_0/0.24)] outline-none transition-[opacity,scale] duration-150 ease-out data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0">
            <Dialog.Title className="text-base font-semibold tracking-[-0.02em]">
              {publicationUrl ? 'Substack settings' : 'Set up Substack'}
            </Dialog.Title>
            <Dialog.Description className="mt-2 text-pretty text-small leading-relaxed text-secondary">
              Add the base URL of your publication. Calmd will open its new article editor.
            </Dialog.Description>
            <form
              onSubmit={(event) => {
                event.preventDefault()
                const formData = new FormData(event.currentTarget)
                onSave(String(formData.get('publicationUrl') ?? '').trim())
              }}
            >
              <label className="mt-5 block text-small text-secondary" htmlFor="substack-publication-url">
                Publication URL
              </label>
              <Input
                aria-describedby="substack-publication-url-help"
                autoComplete="url"
                autoFocus
                className="mt-1.5 h-11 w-full rounded-xl bg-hover px-3 text-small text-ink outline-none placeholder:text-placeholder focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint"
                defaultValue={publicationUrl ?? ''}
                disabled={saving}
                id="substack-publication-url"
                key={`${open}-${publicationUrl ?? ''}`}
                name="publicationUrl"
                placeholder="https://your-publication.substack.com"
              />
              <p className="mt-2 text-small text-faint" id="substack-publication-url-help">
                Use an HTTPS publication URL without a path.
              </p>
              {message ? (
                <p className="mt-2 text-small text-red-500" role="alert">
                  {message}
                </p>
              ) : null}
              <div className="mt-6 flex justify-end gap-2">
                <Dialog.Close
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-hover px-4 text-small text-ink transition-[background-color,transform] duration-150 ease-out hover:bg-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:text-faint"
                  disabled={saving}
                >
                  Cancel
                </Dialog.Close>
                <Button
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-accent px-4 text-small text-accent-ink transition-[background-color,transform] duration-150 ease-out enabled:hover:bg-accent/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-faint active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
                  disabled={saving}
                  type="submit"
                >
                  {saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function WorkspaceActions() {
  const { actions, meta, state } = useNoteWorkspace()
  const { insertImage } = useEditorChrome()
  const [publicationUrl, setPublicationUrl] = useState<string | null>(null)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null)

  useEffect(() => {
    void readStoredSubstackPublicationUrl().then(
      (url) => {
        setPublicationUrl(url)
        setSettingsLoaded(true)
      },
      (error) => {
        setSettingsMessage(getStorageError(error).message)
        setSettingsLoaded(true)
      },
    )
  }, [])

  function openSettings() {
    setSettingsOpen(true)
  }

  async function saveSettings(url: string) {
    setSettingsSaving(true)
    setSettingsMessage(null)
    try {
      const savedUrl = await saveStoredSubstackPublicationUrl(url)
      setPublicationUrl(savedUrl)
      setSettingsOpen(false)
    } catch (error) {
      setSettingsMessage(getStorageError(error).message)
    } finally {
      setSettingsSaving(false)
    }
  }

  async function openCurrentNoteInSubstack() {
    if (!publicationUrl) {
      openSettings()
      return
    }

    try {
      const saved = await actions.flush()
      if (!saved) {
        actions.setMessage('Save the note before opening Substack.')
        return
      }

      await openNoteInSubstack(saved.draft.body, publicationUrl)
      actions.setMessage('Copied note content. Paste it into Substack.')
    } catch (error) {
      actions.setMessage(getStorageError(error).message)
    }
  }

  return (
    <NoteActions
      deleteOpen={state.deleteOpen}
      deleting={state.deleting}
      dialogs={(
        <SubstackSettingsDialog
          message={settingsMessage}
          onOpenChange={setSettingsOpen}
          onSave={(url) => void saveSettings(url)}
          open={settingsOpen}
          publicationUrl={publicationUrl}
          saving={settingsSaving}
        />
      )}
      menuItems={(
        <>
          <Menu.Item
            className="flex h-10 cursor-default select-none items-center gap-2 rounded-lg px-3 outline-none data-[highlighted]:bg-hover disabled:cursor-not-allowed disabled:text-faint"
            disabled={!insertImage}
            onClick={() => insertImage?.()}
          >
            <ImageIcon />
            <span>Insert image…</span>
          </Menu.Item>
          <Menu.CheckboxItem
            checked={meta.spellcheckEnabled}
            className="grid h-10 cursor-default select-none grid-cols-[1rem_1fr_1rem] items-center gap-2 rounded-lg px-3 outline-none data-[highlighted]:bg-hover"
            closeOnClick
            onCheckedChange={meta.onSpellcheckEnabledChange}
          >
            <SpellcheckIcon />
            <span>Spellcheck</span>
            <Menu.CheckboxItemIndicator className="text-accent">
              <CheckIcon />
            </Menu.CheckboxItemIndicator>
          </Menu.CheckboxItem>
          <Menu.Separator className="mx-2 my-1 h-px bg-divider" />
          <Menu.Item
            className="flex h-10 cursor-default select-none items-center gap-2 rounded-lg px-3 outline-none data-[highlighted]:bg-hover disabled:cursor-not-allowed disabled:text-faint"
            disabled={!settingsLoaded}
            onClick={() => void openCurrentNoteInSubstack()}
          >
            <SubstackIcon />
            <span>{publicationUrl ? 'Open in Substack' : 'Set up Substack'}</span>
          </Menu.Item>
          {publicationUrl ? (
            <Menu.Item
              className="flex h-10 cursor-default select-none items-center gap-2 rounded-lg px-3 outline-none data-[highlighted]:bg-hover"
              onClick={openSettings}
            >
              <SubstackIcon />
              <span>Substack settings</span>
            </Menu.Item>
          ) : null}
        </>
      )}
      onDelete={() => void actions.deleteCurrent()}
      onDeleteOpenChange={actions.setDeleteOpen}
    />
  )
}

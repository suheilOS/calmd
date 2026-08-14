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
  const { actions, state } = useNoteWorkspace()
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

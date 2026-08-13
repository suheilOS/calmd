import { convertFileSrc, invoke } from '@tauri-apps/api/core'

export type ResolvedImage = {
  relativePath: string
  absolutePath: string
  mime: string
  width: number
  height: number
  revision: string
}

export type DisplayImage = ResolvedImage & {
  assetUrl: string
}

export type ImportedAttachment = Omit<ResolvedImage, 'absolutePath'>

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

export function importAttachmentBytes(noteKey: string, file: File) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return Promise.reject(new Error('The image is larger than 10 MiB.'))
  }
  return file.arrayBuffer().then((buffer) => invoke<ImportedAttachment>(
    'import_attachment_bytes',
    new Uint8Array(buffer),
    {
      headers: {
        'x-calmd-filename': encodeURIComponent(file.name),
        'x-calmd-note-key': encodeURIComponent(noteKey),
      },
    },
  ))
}

export function pickAttachment(noteKey: string) {
  return invoke<ImportedAttachment | null>('pick_attachment', { noteKey })
}

export async function resolveLocalImage(noteKey: string, destination: string) {
  const resolved = await invoke<ResolvedImage>('resolve_image', { noteKey, destination })
  return {
    ...resolved,
    assetUrl: `${convertFileSrc(resolved.absolutePath)}?revision=${resolved.revision}`,
  }
}

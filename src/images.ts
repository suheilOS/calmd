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

export async function readClipboardImageFile() {
  const { readImage } = await import('@tauri-apps/plugin-clipboard-manager')
  const image = await readImage()
  try {
    const [{ width, height }, rgba] = await Promise.all([image.size(), image.rgba()])
    if (width * height > 40_000_000) {
      throw new Error('The image dimensions are too large.')
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not prepare the clipboard image.')
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
      (value) => value ? resolve(value) : reject(new Error('Could not encode the clipboard image.')),
      'image/png',
    ))
    return new File([blob], 'clipboard.png', { type: 'image/png' })
  } finally {
    await image.close()
  }
}

export async function resolveLocalImage(noteKey: string, destination: string) {
  const resolved = await invoke<ResolvedImage>('resolve_image', { noteKey, destination })
  return {
    ...resolved,
    assetUrl: `${convertFileSrc(resolved.absolutePath)}?revision=${resolved.revision}`,
  }
}

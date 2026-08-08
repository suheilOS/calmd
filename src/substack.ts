export async function openNoteInSubstack(body: string, publicationUrl: string) {
  const [{ writeHtml }, { openUrl }, { marked }] = await Promise.all([
    import('@tauri-apps/plugin-clipboard-manager'),
    import('@tauri-apps/plugin-opener'),
    import('marked'),
  ])
  const html = marked.parse(body, { async: false })
  await writeHtml(html, body)
  await openUrl(new URL('/publish/post', publicationUrl).toString())
}

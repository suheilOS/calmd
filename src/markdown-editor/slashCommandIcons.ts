import type { Completion } from '@codemirror/autocomplete'

const svgNamespace = 'http://www.w3.org/2000/svg'

const paths = {
  'slash-callout': 'M16.19 2H7.81C4.17 2 2 4.17 2 7.81V16.18C2 19.83 4.17 22 7.81 22H16.18C19.82 22 21.99 19.83 21.99 16.19V7.81C22 4.17 19.83 2 16.19 2ZM11.61 14.84C11.61 15.93 10.76 16.78 9.67 16.78H8.19C7.12 16.78 6.25 15.91 6.25 14.84V12.17C6.25 9.09 6.92 8.4 8.71 7.34C8.83 7.27 8.96 7.24 9.09 7.24C9.35 7.24 9.6 7.37 9.74 7.61C9.95 7.97 9.83 8.43 9.48 8.64C8.27 9.34 7.85 9.6 7.77 11.41H9.68C10.77 11.41 11.62 12.26 11.62 13.35V14.84H11.61ZM17.75 14.84C17.75 15.93 16.9 16.78 15.81 16.78H14.32C13.25 16.78 12.38 15.91 12.38 14.84V12.17C12.38 9.09 13.05 8.4 14.84 7.34C14.96 7.27 15.09 7.24 15.22 7.24C15.48 7.24 15.73 7.37 15.87 7.61C16.08 7.97 15.96 8.43 15.61 8.64C14.4 9.36 13.98 9.62 13.9 11.43H15.81C16.9 11.43 17.75 12.28 17.75 13.37V14.84Z',
  'slash-code': 'M3.464 3.464C2 4.929 2 7.286 2 12s0 7.071 1.464 8.536C4.929 22 7.286 22 12 22s7.071 0 8.536-1.464C22 19.071 22 16.714 22 12s0-7.071-1.464-8.536C19.071 2 16.714 2 12 2S4.929 2 3.464 3.464Zm10.024 2.982a.75.75 0 0 1 .53.918l-2.588 9.66a.75.75 0 0 1-1.449-.389l2.589-9.659a.75.75 0 0 1 .918-.53Zm1.482 2.024a.75.75 0 0 1 1.06 0c1.499 1.498 2.392 2.39 2.392 3.53s-.893 2.032-2.392 3.53a.75.75 0 0 1-1.06-1.06c1.594-1.594 1.952-2.08 1.952-2.47s-.358-.876-1.952-2.47a.75.75 0 0 1 0-1.06Zm-7 0a.75.75 0 0 1 1.06 1.06C7.437 11.124 7.08 11.61 7.08 12s.357.876 1.951 2.47a.75.75 0 1 1-1.06 1.06C6.47 14.032 5.578 13.14 5.578 12s.893-2.032 2.392-3.53Z',
  'slash-table': 'M7.81 2h8.38C19.83 2 22 4.17 22 7.81v8.38C22 19.83 19.83 22 16.19 22H7.81C4.17 22 2 19.83 2 16.19V7.81C2 4.17 4.17 2 7.81 2Zm-4.3 7.25h4.74V3.58h-.44c-2.8 0-4.3 1.5-4.3 4.23v1.44Zm6.24 0h4.5V3.5h-4.5v5.75Zm6 0h4.74V7.81c0-2.73-1.5-4.23-4.3-4.23h-.44v5.67ZM3.5 10.75v5.44c0 2.81 1.5 4.31 4.31 4.31h.44v-9.75H3.5Zm6.25 0v9.75h4.5v-9.75h-4.5Zm6 0v9.75h.44c2.81 0 4.31-1.5 4.31-4.31v-5.44h-4.75Z',
  'slash-rule': 'M7.81 2h8.38C19.83 2 22 4.17 22 7.81v8.38C22 19.83 19.83 22 16.19 22H7.81C4.17 22 2 19.83 2 16.19V7.81C2 4.17 4.17 2 7.81 2Zm.19 9.25a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5H8Z',
} as const

export type SlashCommandIcon = keyof typeof paths

function isSlashCommandIcon(value: string): value is SlashCommandIcon {
  return Object.hasOwn(paths, value)
}

export function renderSlashCommandIcon(completion: Completion, document: Document) {
  if (!completion.type || !isSlashCommandIcon(completion.type)) return null
  const pathData = paths[completion.type]
  const svg = document.createElementNS(svgNamespace, 'svg')
  svg.classList.add('cm-slash-command-icon')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('viewBox', '0 0 24 24')
  const path = document.createElementNS(svgNamespace, 'path')
  path.setAttribute('d', pathData)
  path.setAttribute('fill', 'currentColor')
  svg.append(path)
  return svg
}

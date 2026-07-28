import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type NotePreviewContentProps = {
  excerpt: string
}

export default function NotePreviewContent({ excerpt }: NotePreviewContentProps) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children }) => <span className="note-preview-link">{children}</span>,
        img: ({ alt }) => alt ? <span className="note-preview-image-alt">{alt}</span> : null,
      }}
      remarkPlugins={[remarkGfm]}
      skipHtml
    >
      {excerpt}
    </ReactMarkdown>
  )
}

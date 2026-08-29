import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

type NotePreviewContentProps = {
  excerpt: string
}

export default function NotePreviewContent({ excerpt }: NotePreviewContentProps) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children }) => <bdi className="note-preview-link" dir="auto">{children}</bdi>,
        blockquote: ({ children }) => <blockquote dir="auto">{children}</blockquote>,
        code: ({ children, className }) => <code className={className} dir="ltr">{children}</code>,
        h1: ({ children }) => <h1 dir="auto">{children}</h1>,
        h2: ({ children }) => <h2 dir="auto">{children}</h2>,
        h3: ({ children }) => <h3 dir="auto">{children}</h3>,
        h4: ({ children }) => <h4 dir="auto">{children}</h4>,
        h5: ({ children }) => <h5 dir="auto">{children}</h5>,
        h6: ({ children }) => <h6 dir="auto">{children}</h6>,
        img: ({ alt }) => alt ? <bdi className="note-preview-image-alt" dir="auto">{alt}</bdi> : null,
        li: ({ children }) => <li dir="auto">{children}</li>,
        ol: ({ children }) => <ol dir="auto">{children}</ol>,
        p: ({ children }) => <p dir="auto">{children}</p>,
        pre: ({ children }) => <pre dir="ltr">{children}</pre>,
        td: ({ children }) => <td dir="auto">{children}</td>,
        th: ({ children }) => <th dir="auto">{children}</th>,
        ul: ({ children }) => <ul dir="auto">{children}</ul>,
      }}
      remarkPlugins={[remarkGfm]}
      skipHtml
    >
      {excerpt}
    </ReactMarkdown>
  )
}

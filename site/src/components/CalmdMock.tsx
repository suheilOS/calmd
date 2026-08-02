import type { ReactNode } from 'react'
import './calmd-mock.css'

type MockKind = 'composer' | 'retrieval' | 'editor' | 'preview' | 'wiki-preview' | 'backlinks'

type CalmdMockProps = {
  kind: MockKind
}

function BackIcon() {
  return <svg fill="none" viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 3.5-4.5 4.5 4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" /></svg>
}

function ForwardIcon() {
  return <svg fill="none" viewBox="0 0 16 16" aria-hidden="true"><path d="m6.5 3.5 4.5 4.5-4.5 4.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" /></svg>
}

function HomeIcon() {
  return <svg fill="none" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 7.25 8 2.75l5.25 4.5v5.5a.5.5 0 0 1-.5.5h-3V9h-3v4.25h-3a.5.5 0 0 1-.5-.5z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" /></svg>
}

function MinimizeIcon() {
  return <svg fill="none" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 7h8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>
}

function MaximizeIcon() {
  return <svg fill="none" viewBox="0 0 14 14" aria-hidden="true"><rect height="7" rx="0.75" stroke="currentColor" strokeWidth="1.1" width="7" x="3.5" y="3.5" /></svg>
}

function CloseIcon() {
  return <svg fill="none" viewBox="0 0 14 14" aria-hidden="true"><path d="m4 4 6 6m0-6-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" /></svg>
}

function TitleBar() {
  return (
    <div className="calmd-titlebar">
      <div className="calmd-navigation" aria-hidden="true"><span><BackIcon /></span><span><ForwardIcon /></span><span><HomeIcon /></span></div>
      <span className="calmd-title">calmd</span>
      <div className="calmd-window-controls" aria-hidden="true"><span><MinimizeIcon /></span><span><MaximizeIcon /></span><span><CloseIcon /></span></div>
    </div>
  )
}

const notes = {
  retrieval: [
    {
      title: 'Returning to unfinished ideas',
      excerpt: 'Distance makes the shape of an idea easier to see.',
    },
    {
      title: 'Distance creates clarity',
      excerpt: 'Returning to unfinished ideas reveals what still carries energy.',
    },
  ],
}

function Frame({ children, kind, label }: { children: ReactNode; kind: MockKind; label: string }) {
  return (
    <div className={`calmd-mock calmd-mock--${kind}`} role="img" aria-label={label}>
      {kind === 'preview' ? <TitleBar /> : null}
      {children}
    </div>
  )
}

function ComposerMock() {
  return (
    <Frame kind="composer" label="Calmd’s empty composer with a prompt to find a note or start a thought.">
      <div className="calmd-composer"><span className="calmd-placeholder">Find a note or start a thought…</span></div>
    </Frame>
  )
}

function Highlight({ children }: { children: ReactNode }) {
  return <mark>{children}</mark>
}

function RetrievalMock() {
  return (
    <Frame kind="retrieval" label="Calmd retrieving two relevant notes for the search term unfinished ideas.">
      <div className="calmd-composer calmd-composer--results">
        <p className="calmd-query">unfinished ideas</p>
        <div className="calmd-results">
          {notes.retrieval.map((note, index) => (
            <div className={`calmd-result${index === 0 ? ' is-selected' : ''}`} key={note.title}>
              <span className="calmd-result-title">{index === 0 ? <>Returning to <Highlight>unfinished ideas</Highlight></> : note.title}</span>
              <small>{index === 0 ? note.excerpt : <>Returning to <Highlight>unfinished ideas</Highlight> reveals what still carries energy.</>}</small>
            </div>
          ))}
          <div className="calmd-result">Create “unfinished ideas”</div>
        </div>
      </div>
    </Frame>
  )
}

function InfoIcon() {
  return (
    <div className="calmd-info" aria-hidden="true">
      <svg fill="none" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10 9v5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
        <circle cx="10" cy="6.25" r=".85" fill="currentColor" />
      </svg>
    </div>
  )
}

function NoteBody({ preview = false }: { preview?: boolean }) {
  return (
    <div className="calmd-note-body">
      <p>Some ideas become useful only after we stop trying to finish them immediately. The first version captures the energy of discovery, but rarely its clearest shape.</p>
      <p>Time separates the durable part of a thought from the excitement of finding it. Returning later reveals what still feels alive and what was only momentum.</p>
      <p>Writing makes that return possible. Recall <span className="calmd-wiki-link">Writing as retrieval</span>. A sentence gives the thought enough shape to be found again without forcing it to feel complete.</p>
      {!preview ? <p>The goal is not to leave every idea unresolved. It is to preserve enough openness for the next encounter to change it.</p> : null}
    </div>
  )
}

function PreviewCard() {
  return (
    <aside className="calmd-preview-card">
      <h3>Writing as retrieval</h3>
      <div className="calmd-preview-content">
        <p>Writing is not only a way to preserve a thought. It gives the thought a shape that can be found again.</p>
        <p>A useful note leaves enough context to restore the question, not just the answer that happened to appear first.</p>
        <p>Retrieval is part of thinking: each return lets the idea meet a different version of you.</p>
      </div>
      <p className="calmd-preview-more">Open note to continue</p>
    </aside>
  )
}

function BacklinksCard() {
  return (
    <aside className="calmd-backlinks-card">
      <section>
        <h3>Backlinks</h3>
        <div className="calmd-backlink-item"><strong>Notes that remain open</strong></div>
        <div className="calmd-backlink-item"><strong>A place to return</strong></div>
      </section>
      <section className="calmd-mentions">
        <h3>Unlinked mentions</h3>
        <div className="calmd-backlink-item">
          <strong>Distance creates clarity</strong>
          <p><mark>Returning to unfinished ideas</mark> reveals which parts still carry energy.</p>
        </div>
      </section>
    </aside>
  )
}

function EditorMock({ kind, overlay = 'none' }: { kind: 'editor' | 'preview' | 'wiki-preview' | 'backlinks'; overlay?: 'none' | 'preview' | 'backlinks' }) {
  const withPreview = overlay === 'preview'
  const withBacklinks = overlay === 'backlinks'
  const label = withPreview
    ? 'Calmd showing a wiki-link hover preview above the current note.'
    : withBacklinks
      ? 'Calmd showing backlinks and unlinked mentions on demand.'
      : 'A full-page note open in Calmd’s focused Markdown editor.'

  return (
    <Frame kind={kind} label={label}>
      <article className={`calmd-editor${withPreview ? ' calmd-editor--preview' : ''}`}>
        {!withPreview || kind === 'preview' ? <h2>Returning to unfinished ideas</h2> : null}
        <NoteBody preview={withPreview} />
        {withPreview ? <PreviewCard /> : null}
      </article>
      {withBacklinks ? <BacklinksCard /> : null}
      {withBacklinks || kind === 'preview' ? <InfoIcon /> : null}
    </Frame>
  )
}

export default function CalmdMock({ kind }: CalmdMockProps) {
  if (kind === 'composer') return <ComposerMock />
  if (kind === 'retrieval') return <RetrievalMock />
  if (kind === 'backlinks') return <EditorMock kind="backlinks" overlay="backlinks" />
  if (kind === 'preview' || kind === 'wiki-preview') return <EditorMock kind={kind} overlay="preview" />
  return <EditorMock kind="editor" />
}

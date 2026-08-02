import { useEffect, useRef, useState, type ReactNode } from 'react'
import './FeatureShowcase.css'

type Feature = {
  id: string
  number: string
  title: string
  description: string
  kind: 'composer' | 'retrieval' | 'editor' | 'wikilink' | 'backlinks'
}

const features: Feature[] = [
  {
    id: 'start',
    number: '01',
    title: 'Start a thought',
    description: 'A quiet place to begin writing, without a system asking for your attention first.',
    kind: 'composer',
  },
  {
    id: 'retrieve',
    number: '02',
    title: 'Find what you already know',
    description: 'Search stays close to the thought, returning the notes that help you keep going.',
    kind: 'retrieval',
  },
  {
    id: 'develop',
    number: '03',
    title: 'Develop the thought',
    description: 'A focused Markdown editor gives the idea room without surrounding it with a dashboard.',
    kind: 'editor',
  },
  {
    id: 'connect',
    number: '04',
    title: 'Connect without leaving',
    description: 'Hover a wiki link to get just enough context, then return to the thought in front of you.',
    kind: 'wikilink',
  },
  {
    id: 'backlinks',
    number: '05',
    title: 'Reveal context when needed',
    description: 'Backlinks stay out of the way until you ask what else points here.',
    kind: 'backlinks',
  },
]

function BackIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="m9.5 3.5-4.5 4.5 4.5 4.5" />
    </svg>
  )
}

function ForwardIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="m6.5 3.5 4.5 4.5-4.5 4.5" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 16 16">
      <path d="M2.75 7.25 8 2.75l5.25 4.5v5.5a.5.5 0 0 1-.5.5h-3V9h-3v4.25h-3a.5.5 0 0 1-.5-.5z" />
    </svg>
  )
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" />
      <path d="M10 9v5" />
      <circle className="is-filled" cx="10" cy="6.25" r=".85" />
    </svg>
  )
}

function AppTitleBar() {
  return (
    <div className="product-titlebar">
      <div className="product-titlebar-group">
        <span><BackIcon /></span>
        <span><ForwardIcon /></span>
        <span><HomeIcon /></span>
      </div>
      <span className="product-titlebar-brand">calmd</span>
      <div className="product-titlebar-group product-titlebar-window-controls">
        <span className="product-window-minimize" />
        <span className="product-window-maximize" />
        <span className="product-window-close" />
      </div>
    </div>
  )
}

function AppCrop({ children, kind }: { children: ReactNode; kind: Feature['kind'] }) {
  return (
    <div className={`mock-surface mock-surface--${kind}`} aria-hidden="true">
      <div className="product-crop">
        <AppTitleBar />
        <div className={`product-crop-content product-crop-content--${kind}`}>
          {children}
        </div>
      </div>
    </div>
  )
}

function ComposerMock() {
  return (
    <AppCrop kind="composer">
      <div className="product-composer-placeholder">Find a note or start a thought…</div>
    </AppCrop>
  )
}

function Match({ children }: { children: ReactNode }) {
  return <mark className="product-match">{children}</mark>
}

function RetrievalMock() {
  return (
    <AppCrop kind="retrieval">
      <div className="product-retrieval">
        <div className="product-query">monitor</div>
        <div className="product-results">
          <div className="product-result product-result--active">
            <span className="product-result-title">Choosing a <Match>monitor</Match> for the desk</span>
            <span className="product-result-excerpt">Text should stay sharp at the distance you actually use…</span>
          </div>
          <div className="product-result">
            <span className="product-result-title">A desk setup that supports deep work</span>
            <span className="product-result-excerpt">Keep the <Match>monitor</Match> at eye level and leave enough space to write beside it…</span>
          </div>
          <div className="product-result">
            <span className="product-result-title">Create “monitor”</span>
          </div>
        </div>
      </div>
    </AppCrop>
  )
}

function NotePreviewMock() {
  return (
    <span className="product-note-preview">
      <strong>Choosing a monitor for the desk</strong>
      <span>
        Text should stay sharp at the distance you actually use. Resolution matters more than size once a screen is close enough.
      </span>
      <span>Leave room beside it for a notebook.</span>
    </span>
  )
}

function EditorCopy({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="product-editor-title">A desk setup that supports deep work</div>
      <div className="product-editor-body">
        <p>
          The setup should make the next action obvious: a clear desk, a comfortable chair, and one screen at eye level.
        </p>
        <p>
          Keep the things used every day within reach. Everything else can live somewhere else.
        </p>
        <p>
          A monitor should make reading easier, not take over the desk. See {children}
        </p>
      </div>
    </>
  )
}

function WikiLink() {
  return <><span className="product-wiki-link">Choosing a monitor for the desk</span>.</>
}

function PreviewedWikiLink() {
  return (
    <>
      <span className="product-wiki-link is-previewed">Choosing a monitor for the desk</span>.
      <NotePreviewMock />
    </>
  )
}

function EditorMock() {
  return (
    <AppCrop kind="editor">
      <div className="product-editor">
        <EditorCopy><WikiLink /></EditorCopy>
      </div>
      <div className="product-info-trigger"><InfoIcon /></div>
    </AppCrop>
  )
}

function WikiLinkMock() {
  return (
    <AppCrop kind="wikilink">
      <div className="product-editor product-editor--preview">
        <EditorCopy><PreviewedWikiLink /></EditorCopy>
      </div>
    </AppCrop>
  )
}

function BacklinksMock() {
  return (
    <AppCrop kind="backlinks">
      <div className="product-editor product-editor--backlinks">
        <EditorCopy><WikiLink /></EditorCopy>
      </div>
      <div className="product-backlinks-popover">
        <section>
          <strong>Backlinks</strong>
          <div className="product-backlink-row">A quieter workspace</div>
          <div className="product-backlink-row">Working from home without the clutter</div>
        </section>
        <section>
          <strong>Unlinked mentions</strong>
          <div className="product-backlink-row">
            <span>The things within reach</span>
            <small>A smaller workspace is easier to maintain when every object has a place.</small>
          </div>
        </section>
      </div>
      <div className="product-info-trigger product-info-trigger--active"><InfoIcon /></div>
    </AppCrop>
  )
}

function FeatureMock({ kind }: { kind: Feature['kind'] }) {
  switch (kind) {
    case 'composer':
      return <ComposerMock />
    case 'retrieval':
      return <RetrievalMock />
    case 'editor':
      return <EditorMock />
    case 'wikilink':
      return <WikiLinkMock />
    case 'backlinks':
      return <BacklinksMock />
  }
}

function CarouselArrow({ direction }: { direction: 'previous' | 'next' }) {
  const path = direction === 'previous'
    ? 'm9.5 3.5-4.5 4.5 4.5 4.5'
    : 'm6.5 3.5 4.5 4.5-4.5 4.5'

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d={path} />
    </svg>
  )
}

export default function FeatureShowcase() {
  const showcaseRef = useRef<HTMLElement>(null)
  const cardsRef = useRef<HTMLDivElement>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const showcase = showcaseRef.current
    if (!showcase) return

    const cardsContainer = cardsRef.current
    if (!cardsContainer) return

    const cards = Array.from(showcase.querySelectorAll<HTMLElement>('[data-feature-card]'))
    const carouselLayout = window.matchMedia('(max-width: 64rem)')
    let frame = 0

    const updateActiveFeature = () => {
      frame = 0
      const isCarouselLayout = carouselLayout.matches
      const viewportCenter = isCarouselLayout
        ? (() => {
            const rect = cardsContainer.getBoundingClientRect()
            return rect.left + rect.width / 2
          })()
        : window.innerHeight / 2
      const visibleCards = cards.flatMap((card) => {
        const rect = card.getBoundingClientRect()
        const isVisible = isCarouselLayout
          ? rect.right > 0 && rect.left < window.innerWidth
          : rect.bottom > 0 && rect.top < window.innerHeight
        const cardCenter = isCarouselLayout
          ? rect.left + rect.width / 2
          : rect.top + rect.height / 2

        return isVisible
          ? [{ card, distance: Math.abs(cardCenter - viewportCenter) }]
          : []
      })

      if (visibleCards.length === 0) return

      const closestCard = visibleCards.reduce((closest, candidate) => (
        candidate.distance < closest.distance ? candidate : closest
      )).card
      const nextIndex = Number(closestCard.dataset.featureIndex)

      setActiveIndex((currentIndex) => currentIndex === nextIndex ? currentIndex : nextIndex)
    }

    const scheduleUpdate = () => {
      if (frame) return
      frame = requestAnimationFrame(updateActiveFeature)
    }

    updateActiveFeature()
    cardsContainer.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate, { passive: true })
    carouselLayout.addEventListener('change', scheduleUpdate)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      cardsContainer.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      carouselLayout.removeEventListener('change', scheduleUpdate)
    }
  }, [])

  function showFeature(index: number) {
    const cardsContainer = cardsRef.current
    const card = cardsContainer?.querySelector<HTMLElement>(`[data-feature-index="${index}"]`)
    const firstCard = cardsContainer?.querySelector<HTMLElement>('[data-feature-card]')
    if (!cardsContainer || !card || !firstCard) return

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    cardsContainer.scrollTo({
      left: card.offsetLeft - firstCard.offsetLeft,
      behavior: reducedMotion ? 'auto' : 'smooth',
    })
  }

  const activeFeature = features[activeIndex]

  return (
    <section className="feature-showcase" ref={showcaseRef} aria-label="Calmd features">
      <div className="feature-cards" ref={cardsRef}>
        {features.map((feature, index) => (
          <article
            className="feature-card"
            data-feature-card
            data-feature-index={index}
            key={feature.id}
            aria-labelledby={`feature-${feature.id}-title`}
          >
            <h3 className="sr-only" id={`feature-${feature.id}-title`}>{feature.title}</h3>
            <FeatureMock kind={feature.kind} />
          </article>
        ))}
      </div>

      <aside className="feature-index" aria-label="Calmd feature index">
        <ol>
          {features.map((feature, index) => {
            const isActive = index === activeIndex

            return (
              <li className={`feature-index-item${isActive ? ' is-active' : ''}`} aria-current={isActive ? 'step' : undefined} key={feature.id}>
                <span className="feature-index-number">{feature.number}</span>
                <div className="feature-index-copy">
                  <strong>{feature.title}</strong>
                  {isActive ? <p>{feature.description}</p> : null}
                </div>
              </li>
            )
          })}
        </ol>
      </aside>

      <div className="feature-mobile-meta">
        <div className="feature-mobile-controls" aria-label="Choose a Calmd feature" role="group">
          <button
            aria-label="Show previous feature"
            className="feature-mobile-arrow"
            disabled={activeIndex === 0}
            onClick={() => showFeature(activeIndex - 1)}
            type="button"
          >
            <CarouselArrow direction="previous" />
          </button>
          <div aria-hidden="true" className="feature-mobile-progress">
            {features.map((feature, index) => (
              <span
                className={`feature-mobile-dot${index === activeIndex ? ' is-active' : ''}`}
                key={feature.id}
              />
            ))}
          </div>
          <button
            aria-label="Show next feature"
            className="feature-mobile-arrow"
            disabled={activeIndex === features.length - 1}
            onClick={() => showFeature(activeIndex + 1)}
            type="button"
          >
            <CarouselArrow direction="next" />
          </button>
        </div>

        <div className="feature-mobile-copy">
          <strong>{activeFeature.title}</strong>
          <p>{activeFeature.description}</p>
        </div>
      </div>
    </section>
  )
}

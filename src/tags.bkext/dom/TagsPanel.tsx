import { DOMExtensionContext } from 'bike/dom'
import { SFSymbol } from 'bike/components'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useState } from 'react'
import './tags.css'
import { PanelState, TagsProtocol } from './protocols'

// The inspector's Tags list: every tag with its row count. Click to show
// those rows, click again to clear. Hover a tag to rename it everywhere.

const SEARCH_THRESHOLD = 12

function Panel({ context }: { context: DOMExtensionContext<TagsProtocol> }) {
  const [state, setState] = useState<PanelState | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    context.onmessage = (message) => {
      if (message.type === 'state') setState(message.state)
    }
    context.postMessage({ type: 'ready' })
  }, [context])

  const tags = state?.tags ?? []
  const shown = useMemo(() => {
    const q = query.trim().replace(/^#/, '').toLowerCase()
    return q ? tags.filter((t) => t.name.includes(q)) : tags
  }, [tags, query])

  if (!state) return <div className="rt-root" />
  if (!state.hasOutline) {
    return (
      <div className="rt-root">
        <p className="rt-empty">{bike.localize('Open an outline to see its tags.')}</p>
      </div>
    )
  }

  const send = (message: TagsProtocol['toApp']) => context.postMessage(message)

  return (
    <div className="rt-root">
      <div className="rt-head">
        <span className="rt-title">{bike.localize('Tags')}</span>
        {tags.length > 0 && <span className="rt-total">{tags.length}</span>}
        <span className="rt-spacer" />
        <button className="rt-icon" aria-label={bike.localize('Add Tag to Selected Rows')} title={bike.localize('Add Tag to Selected Rows (⌘⇧T)')} onClick={() => send({ type: 'add' })}>
          <SFSymbol name="plus" />
        </button>
      </div>

      {state.active && (
        <div className="rt-active">
          <span>{bike.localize('Showing')}</span>
          <span className="rt-chip">
            <SFSymbol name="tag.fill" scale="small" aria-hidden="true" />
            {state.active}
          </span>
          <span className="rt-spacer" />
          <button className="rt-link" onClick={() => send({ type: 'clear' })}>
            {bike.localize('Clear')}
          </button>
        </div>
      )}

      {state.hashTagRows > 0 && (
        <div className="rt-note">
          <span>
            {bike.localize('{count, plural, one {# row still has} other {# rows still have}} inline #tags.', { count: state.hashTagRows })}
          </span>
          <button className="rt-link" onClick={() => send({ type: 'convert' })}>
            {bike.localize('Convert…')}
          </button>
        </div>
      )}

      {tags.length > SEARCH_THRESHOLD && (
        <input
          className="rt-search"
          type="search"
          placeholder={bike.localize('Find a tag')}
          aria-label={bike.localize('Find a tag')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {tags.length === 0 ? (
        <p className="rt-empty">{bike.localize('No tags yet. Select a row and press ⌘⇧T.')}</p>
      ) : shown.length === 0 ? (
        <p className="rt-empty">{bike.localize('No tags match.')}</p>
      ) : (
        <ul className="rt-list">
          {shown.map((tag) => {
            const on = tag.name === state.active
            return (
              <li key={tag.name} className={on ? 'rt-item rt-on' : 'rt-item'}>
                <button
                  className="rt-tag"
                  aria-pressed={on}
                  title={on ? bike.localize('Clear tag filter') : bike.localize('Show rows tagged #{tag}', { tag: tag.name })}
                  onClick={() => send({ type: 'toggle', tag: tag.name })}
                >
                  <SFSymbol className="rt-icon-tag" name="tag.fill" scale="small" aria-hidden="true" />
                  <span className="rt-name">{tag.name}</span>
                  <span className="rt-count">{tag.count}</span>
                </button>
                <button
                  className="rt-rename"
                  aria-label={bike.localize('Rename #{tag}', { tag: tag.name })}
                  title={bike.localize('Rename everywhere…')}
                  onClick={() => send({ type: 'rename', tag: tag.name })}
                >
                  <SFSymbol name="pencil" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function activate(context: DOMExtensionContext<TagsProtocol>) {
  createRoot(context.element).render(<Panel context={context} />)
}

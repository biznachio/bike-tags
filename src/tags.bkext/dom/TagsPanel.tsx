import { DOMExtensionContext } from 'bike/dom'
import { Disclosure, SFSymbol } from 'bike/components'
import { createRoot } from 'react-dom/client'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as KeyEvent } from 'react'
import './tags.css'
import { completionFor, findTags, topMatch } from './find'
import { OTHER_AREAS, PanelFilter, PanelHeatmap, PanelSelection, PanelState, PanelTag, TagsProtocol } from './protocols'

// The inspector's Tags section. Each area has one job, and says so:
//
// - The yellow notice (only while inline #tags remain) opens the Convert window.
// - The card tags the selected rows, or, while filtering, describes the filter.
// - "Filter by tag" filters: click tags to select them; rows must have them
//   all. List and Map are two views of the same tags.

const OPEN_KEY = 'panelOpen'
const VIEW_KEY = 'filterView'

type Send = (message: TagsProtocol['toApp']) => void
type View = 'list' | 'map'

function rowsText(count: number): string {
  return bike.localize('{count, plural, one {# row} other {# rows}}', { count })
}

function TagIcon() {
  return <SFSymbol className="rt-tag-icon" name="tag.fill" scale="small" aria-hidden="true" />
}

function Panel({ context }: { context: DOMExtensionContext<TagsProtocol> }) {
  const [state, setState] = useState<PanelState | null>(null)
  const [open, setOpen] = useState(() => bike.defaults.get(OPEN_KEY) !== false)
  const [view, setView] = useState<View>(() => (bike.defaults.get(VIEW_KEY) === 'map' ? 'map' : 'list'))

  useEffect(() => {
    context.onmessage = (message) => {
      if (message.type === 'state') setState(message.state)
    }
    context.postMessage({ type: 'ready' })
  }, [context])

  const send: Send = (message) => context.postMessage(message)
  const count = state?.tags.length ?? 0

  const toggleOpen = (value: boolean) => {
    setOpen(value)
    bike.defaults.set(OPEN_KEY, value)
  }
  const chooseView = (value: View) => {
    setView(value)
    bike.defaults.set(VIEW_KEY, value)
  }

  const label = (
    <span className="rt-title">
      {bike.localize('Tags')}
      {count > 0 && <span className="rt-total">{count}</span>}
    </span>
  )
  // Section-wide: done and canceled rows drop out of filters, counts and the map.
  const hideDoneSwitch = state?.hasOutline ? (
    <label
      className="rt-switch"
      title={bike.localize('Leave done and canceled rows out of tag filters, counts and the map')}
      onClick={(e) => e.stopPropagation()}
    >
      <span>{bike.localize('Hide done')}</span>
      <input type="checkbox" role="switch" checked={state.hideDone} onChange={(e) => send({ type: 'hideDone', value: e.target.checked })} />
      <span className="rt-switch-track" aria-hidden="true">
        <span className="rt-switch-thumb" />
      </span>
    </label>
  ) : undefined

  return (
    <div className="rt-root">
      <Disclosure label={label} expanded={open} onChange={toggleOpen} accessory={hideDoneSwitch} accessoryAlignment="trailing">
        {!state ? null : !state.hasOutline ? (
          <p className="rt-empty">{bike.localize('Open an outline to see its tags.')}</p>
        ) : (
          <Body state={state} send={send} view={view} onView={chooseView} />
        )}
      </Disclosure>
    </div>
  )
}

function Body({ state, send, view, onView }: { state: PanelState; send: Send; view: View; onView: (v: View) => void }) {
  return (
    <div className="rt-body">
      {state.hashTagRows > 0 && <ConvertNotice count={state.hashTagRows} send={send} />}
      {state.filter ? <FilterCard filter={state.filter} send={send} /> : state.selection && <ThisRow selection={state.selection} send={send} />}
      {state.tags.length === 0 ? (
        <p className="rt-empty rt-pad">{bike.localize('No tags yet. Select a row and press ⌘⇧T.')}</p>
      ) : (
        <FilterByTag state={state} send={send} view={view} onView={onView} />
      )}
    </div>
  )
}

// MARK: - Notice

function ConvertNotice({ count, send }: { count: number; send: Send }) {
  return (
    <div className="rt-notice" role="alert">
      <SFSymbol className="rt-notice-icon" name="exclamationmark.triangle.fill" aria-hidden="true" />
      <div className="rt-notice-text">
        <span className="rt-notice-title">{bike.localize('{count, plural, one {# row has} other {# rows have}} inline #tags', { count })}</span>
        <span className="rt-notice-detail">{bike.localize('They won’t show in Tags until they’re converted.')}</span>
      </div>
      <button className="rt-notice-button" onClick={() => send({ type: 'convert' })}>
        {bike.localize('Review…')}
      </button>
    </div>
  )
}

// MARK: - Cards

function Chip({ tag, variant, onRemove, removeLabel }: { tag: string; variant?: 'partial' | 'active'; onRemove: () => void; removeLabel: string }) {
  return (
    <span className={variant ? `rt-chip rt-chip-${variant}` : 'rt-chip'} title={variant === 'partial' ? bike.localize('On some of the selected rows') : undefined}>
      {variant !== 'active' && <TagIcon />}
      <span>{tag}</span>
      <button className="rt-chip-x" aria-label={removeLabel} onClick={onRemove}>
        <SFSymbol name="xmark" scale="small" />
      </button>
    </span>
  )
}

function ThisRow({ selection, send }: { selection: PanelSelection; send: Send }) {
  const remove = (tag: string) => () => send({ type: 'removeRowTag', tag })
  const has = selection.all.length + selection.some.length > 0
  return (
    <section className="rt-section" aria-label={bike.localize('Tags on the selected rows')}>
      <div className="rt-section-head">
        <span className="rt-card-label">{bike.localize('This row')}</span>
        <span className="rt-card-subject">{selection.label}</span>
      </div>
      <div className="rt-card">
        {has && (
          <div className="rt-chips">
            {selection.all.map((tag) => (
              <Chip key={tag} tag={tag} onRemove={remove(tag)} removeLabel={bike.localize('Remove {tag}', { tag })} />
            ))}
            {selection.some.map((tag) => (
              <Chip key={tag} tag={tag} variant="partial" onRemove={remove(tag)} removeLabel={bike.localize('Remove {tag}', { tag })} />
            ))}
          </div>
        )}
        <div className="rt-chips">
          <span className="rt-add-label">{bike.localize('Add')}</span>
          {selection.suggest.map((tag) => (
            <button key={tag} className="rt-suggest" onClick={() => send({ type: 'addRowTag', tag })} aria-label={bike.localize('Add {tag}', { tag })}>
              <SFSymbol name="plus" scale="small" />
              {tag}
            </button>
          ))}
          <button className="rt-link rt-other" title={bike.localize('Pick or create a tag (⌘⇧T)')} onClick={() => send({ type: 'add' })}>
            {selection.suggest.length > 0 ? bike.localize('Other…') : bike.localize('Add Tag…')}
          </button>
        </div>
      </div>
    </section>
  )
}

function FilterCard({ filter, send }: { filter: PanelFilter; send: Send }) {
  return (
    <section className="rt-section" aria-label={bike.localize('Tag filter')}>
      <div className="rt-section-head">
        <span className="rt-card-label">{bike.localize('Showing rows with')}</span>
        <span className="rt-spacer" />
        <button className="rt-link rt-head-action" onClick={() => send({ type: 'clear' })}>
          {bike.localize('Clear filter')}
        </button>
      </div>
      <div className="rt-card rt-card-roomy">
        <div className="rt-sentence">
          {filter.tags.map((tag, i) => (
            <span key={tag} className="rt-sentence-part">
              {i > 0 && <span className="rt-muted">{bike.localize('and')}</span>}
              <Chip tag={tag} variant="active" onRemove={() => send({ type: 'removeFilterTag', tag })} removeLabel={bike.localize('Remove {tag} from the filter', { tag })} />
            </span>
          ))}
          {filter.area && <span className="rt-muted">{bike.localize('in {area}', { area: filter.area.name })}</span>}
        </div>
        <span className="rt-muted rt-small">{rowsText(filter.hideDone ? filter.open : filter.rows)}</span>
      </div>
    </section>
  )
}

// MARK: - Filter by tag

function FilterByTag({ state, send, view, onView }: { state: PanelState; send: Send; view: View; onView: (v: View) => void }) {
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const shown = useMemo(() => findTags(state.tags, query), [state.tags, query])
  const filtering = !!state.filter
  const active = state.filter?.tags ?? []
  const match = topMatch(shown, query, state.hideDone, (name) => !active.includes(name) && !isDim(state.filter, name))
  const completion = completionFor(match, query)

  const openFind = () => {
    setFinding(true)
    setTimeout(() => field.current?.focus(), 0)
  }
  const closeFind = () => {
    setFinding(false)
    setQuery('')
  }

  // ⌘F opens the field while the panel has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openFind()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onFieldKey = (e: KeyEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeFind()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (match) {
        send({ type: 'toggleFilterTag', tag: match.name })
        setQuery('')
      }
    } else if ((e.key === 'Tab' && !e.shiftKey) || (e.key === 'ArrowRight' && e.currentTarget.selectionStart === query.length)) {
      if (completion) {
        e.preventDefault()
        setQuery(query + completion)
      }
    }
  }

  const hint = finding
    ? bike.localize('Return adds the top match to the filter. Esc closes the field.')
    : view === 'map'
      ? filtering
        ? bike.localize('Faded tags never appear with the selected ones. Click a cell to narrow to one area.')
        : bike.localize('Click a tag to filter, or a cell to see that tag in one area.')
      : filtering
        ? bike.localize('Faded tags never appear with the selected ones.')
        : bike.localize('Click a tag to show its rows. Click more to narrow.')

  return (
    <section className="rt-section" aria-label={bike.localize('Filter by tag')}>
      <div className="rt-section-head">
        <span className="rt-card-label">{bike.localize('Filter by tag')}</span>
        <span className="rt-spacer" />
        <button
          className={finding ? 'rt-find-button rt-find-on' : 'rt-find-button'}
          aria-label={bike.localize('Find a tag')}
          aria-pressed={finding}
          title={bike.localize('Find a tag (⌘F)')}
          onClick={() => (finding ? closeFind() : openFind())}
        >
          <SFSymbol name="magnifyingglass" scale="small" />
        </button>
        <div className="rt-segmented" role="radiogroup" aria-label={bike.localize('View')}>
          <button role="radio" aria-checked={view === 'list'} className={view === 'list' ? 'rt-seg rt-seg-on' : 'rt-seg'} onClick={() => onView('list')}>
            <SFSymbol name="list.bullet" scale="small" />
            {bike.localize('List')}
          </button>
          <button role="radio" aria-checked={view === 'map'} className={view === 'map' ? 'rt-seg rt-seg-on' : 'rt-seg'} onClick={() => onView('map')}>
            <SFSymbol name="square.grid.2x2" scale="small" />
            {bike.localize('Map')}
          </button>
        </div>
      </div>

      {finding && (
        <div className="rt-find">
          <SFSymbol className="rt-find-icon" name="magnifyingglass" scale="small" aria-hidden="true" />
          <div className="rt-find-ghost" aria-hidden="true">
            <span className="rt-find-typed">{query}</span>
            {completion}
          </div>
          <input
            ref={field}
            className="rt-search"
            type="text"
            placeholder={bike.localize('Find a tag')}
            aria-label={bike.localize('Find a tag')}
            aria-describedby="rt-find-hint"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFieldKey}
          />
          <span className="rt-find-key" aria-hidden="true">esc</span>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="rt-empty rt-pad">{bike.localize('No tags match.')}</p>
      ) : view === 'list' ? (
        <TagList tags={shown} state={state} send={send} />
      ) : (
        <Heatmap heatmap={state.heatmap} tags={shown} filter={state.filter} send={send} />
      )}
      <p className="rt-hint" id="rt-find-hint">{hint}</p>
    </section>
  )
}

/** While filtering, a tag that never appears with the selected ones can't narrow it further. */
function isDim(filter: PanelFilter | undefined, tag: string): boolean {
  return !!filter && !filter.tags.includes(tag) && !filter.combinable[tag]
}

function filterTitle(filter: PanelFilter | undefined, tag: string): string {
  if (isDim(filter, tag)) return bike.localize('No rows have #{tag} with the selected tags', { tag })
  if (filter?.tags.includes(tag)) return bike.localize('Take #{tag} out of the filter', { tag })
  return bike.localize('Add #{tag} to the filter', { tag })
}

function TagList({ tags, state, send }: { tags: PanelTag[]; state: PanelState; send: Send }) {
  const max = Math.max(1, ...state.tags.map((t) => t.count))
  const active = new Set(state.filter?.tags ?? [])
  return (
    <ul className="rt-list">
      {tags.map((tag) => {
        const on = active.has(tag.name)
        const dim = isDim(state.filter, tag.name)
        return (
          <li key={tag.name} className={on ? 'rt-item rt-on' : dim ? 'rt-item rt-dim' : 'rt-item'}>
            <button
              className="rt-tag"
              aria-pressed={on}
              aria-disabled={dim}
              title={filterTitle(state.filter, tag.name)}
              onClick={() => {
                if (!dim) send({ type: 'toggleFilterTag', tag: tag.name })
              }}
            >
              {on ? <SFSymbol className="rt-tag-icon" name="checkmark.circle.fill" scale="small" aria-hidden="true" /> : <TagIcon />}
              <span className="rt-name">{tag.name}</span>
              <span className="rt-bar" aria-hidden="true">
                <span className="rt-bar-open" style={{ width: `${(tag.open / max) * 100}%` }} />
                {!state.hideDone && <span className="rt-bar-done" style={{ width: `${((tag.count - tag.open) / max) * 100}%` }} />}
              </span>
              {state.hideDone ? (
                <span className="rt-count" aria-label={rowsText(tag.open)}>
                  <b>{tag.open}</b>
                </span>
              ) : (
                <span className="rt-count" aria-label={bike.localize('{open} not done of {total}', { open: tag.open, total: tag.count })}>
                  <b>{tag.open}</b> / {tag.count}
                </span>
              )}
            </button>
            <button
              className="rt-rename"
              aria-label={bike.localize('Rename #{tag}', { tag: tag.name })}
              title={bike.localize('Rename everywhere…')}
              onClick={() => send({ type: 'rename', tag: tag.name })}
            >
              <SFSymbol name="pencil" scale="small" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function heatLevel(n: number, max: number): number {
  if (n === 0) return 0
  return Math.min(5, 1 + Math.floor((n / max) * 4.999))
}

function Heatmap({ heatmap, tags, filter, send }: { heatmap: PanelHeatmap; tags: PanelTag[]; filter?: PanelFilter; send: Send }) {
  if (heatmap.areas.length === 0) return <p className="rt-empty rt-pad">{bike.localize('No tagged rows yet.')}</p>
  const max = Math.max(1, ...Object.values(heatmap.cells).flat())
  const active = new Set(filter?.tags ?? [])
  const columns = `minmax(72px, 1.4fr) repeat(${heatmap.areas.length}, minmax(0, 1fr))`
  return (
    <div className="rt-heat" role="table" aria-label={bike.localize('Tagged rows by area')} style={{ gridTemplateColumns: columns }}>
      <span role="columnheader" />
      {heatmap.areas.map((area) => (
        <span key={area.id} role="columnheader" className="rt-heat-area" title={area.full ?? area.name}>
          {area.name}
        </span>
      ))}
      {tags.flatMap((tag) => {
        const counts = heatmap.cells[tag.name] ?? heatmap.areas.map(() => 0)
        const on = active.has(tag.name)
        const dim = isDim(filter, tag.name)
        return [
          <button
            key={`${tag.name}:label`}
            role="rowheader"
            aria-pressed={on}
            aria-disabled={dim}
            className={on ? 'rt-heat-tag rt-heat-tag-on' : dim ? 'rt-heat-tag rt-dim' : 'rt-heat-tag'}
            title={filterTitle(filter, tag.name)}
            onClick={() => {
              if (!dim) send({ type: 'toggleFilterTag', tag: tag.name })
            }}
          >
            {tag.name}
          </button>,
          ...counts.map((n, i) => {
            const area = heatmap.areas[i]
            const picked = filter?.area?.id === area.id && filter.tags.length === 1 && filter.tags[0] === tag.name
            return (
              <button
                key={`${tag.name}:${area.id}`}
                role="cell"
                className={`rt-heat-cell rt-heat-${heatLevel(n, max)}${picked ? ' rt-heat-picked' : ''}${dim ? ' rt-dim' : ''}`}
                disabled={n === 0}
                title={
                  area.id === OTHER_AREAS
                    ? bike.localize('Show #{tag} everywhere ({areas} hold {rows})', { tag: tag.name, areas: area.full ?? '', rows: rowsText(n) })
                    : bike.localize('Show #{tag} in {area}', { tag: tag.name, area: area.name })
                }
                aria-label={bike.localize('{tag} in {area}: {rows}', { tag: tag.name, area: area.name, rows: rowsText(n) })}
                onClick={() => send({ type: 'heatCell', tag: tag.name, areaId: area.id })}
              >
                {n > 0 ? n : ''}
              </button>
            )
          }),
        ]
      })}
    </div>
  )
}

export function activate(context: DOMExtensionContext<TagsProtocol>) {
  createRoot(context.element).render(<Panel context={context} />)
}

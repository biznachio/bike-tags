import { DOMExtensionContext } from 'bike/dom'
import { SFSymbol } from 'bike/components'
import { createRoot } from 'react-dom/client'
import { useEffect, useRef, useState } from 'react'
import './tags.css'
import { ConvertItem, ConvertProtocol } from './protocols'

// The Convert window: every row with inline #tags, each with a checkbox, so
// false positives (an issue number, a chat channel) can be left alone.

function Sheet({ context }: { context: DOMExtensionContext<ConvertProtocol> }) {
  const [items, setItems] = useState<ConvertItem[] | null>(null)
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const selectAll = useRef<HTMLInputElement>(null)

  useEffect(() => {
    context.onmessage = (message) => {
      if (message.type === 'items') {
        setItems(message.items)
        setChecked(new Set(message.items.map((item) => item.id)))
      }
    }
    context.postMessage({ type: 'ready' })
  }, [context])

  const total = items?.length ?? 0
  const count = checked.size
  useEffect(() => {
    if (selectAll.current) selectAll.current.indeterminate = count > 0 && count < total
  }, [count, total])

  const toggle = (id: number) =>
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleAll = () => setChecked(count === total ? new Set() : new Set((items ?? []).map((item) => item.id)))
  const convert = () => {
    if (!items || count === 0) return
    context.postMessage({ type: 'convert', ids: items.filter((item) => checked.has(item.id)).map((item) => item.id) })
  }

  return (
    <div className="rt-root rt-sheet">
      <div className="rt-sheet-head">
        <h1>{bike.localize('Convert inline #tags')}</h1>
        <p>{bike.localize('Checked rows move their #tags into the tag attribute and drop them from the text. You can undo this.')}</p>
      </div>

      <section className="rt-card rt-card-flush">
        <label className="rt-sheet-all">
          <input ref={selectAll} type="checkbox" checked={total > 0 && count === total} onChange={toggleAll} />
          <span className="rt-spacer">{bike.localize('Select all')}</span>
          <span className="rt-muted">{bike.localize('{count} of {total} selected', { count, total })}</span>
        </label>
        <ul className="rt-sheet-list">
          {(items ?? []).map((item) => {
            const on = checked.has(item.id)
            return (
              <li key={item.id} className={on ? 'rt-sheet-item' : 'rt-sheet-item rt-sheet-off'}>
                <label>
                  <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                  <span className="rt-sheet-text">
                    <span className="rt-sheet-before">{item.before}</span>
                    <span className="rt-sheet-after">
                      <span>{item.after || bike.localize('(empty row)')}</span>
                      {item.tags.map((tag) => (
                        <span key={tag} className="rt-chip rt-chip-small">
                          <SFSymbol className="rt-tag-icon" name="tag.fill" scale="small" aria-hidden="true" />
                          <span>{tag}</span>
                        </span>
                      ))}
                    </span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </section>

      <div className="rt-sheet-foot">
        <span className="rt-spacer rt-muted">{bike.localize('Tags are lowercased, so #Idea and #idea merge.')}</span>
        <button className="rt-button" onClick={() => context.postMessage({ type: 'cancel' })}>
          {bike.localize('Cancel')}
        </button>
        <button className="rt-button rt-button-primary" disabled={count === 0} onClick={convert}>
          {bike.localize('{count, plural, one {Convert # Row} other {Convert # Rows}}', { count })}
        </button>
      </div>
    </div>
  )
}

export function activate(context: DOMExtensionContext<ConvertProtocol>) {
  createRoot(context.element).render(<Sheet context={context} />)
}

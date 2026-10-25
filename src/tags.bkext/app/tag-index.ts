import type { Disposable, Outline, OutlineChange, Row } from 'bike/app'
import { TAG_ATTRIBUTE as ATTR, findHashTags, parseTags } from './tag-core'
import type { HashTagHit } from './tag-core'
import type { IndexedArea, IndexedRow } from './panel-model'

// A per-outline cache of what Tags reads: every tagged row's tags, status and
// area, and which rows still hold inline #tags.
//
// Each read across the bridge to Bike has a cost, so the index reads the
// outline once and then follows its change events:
//
// - Tag, status and structure changes mark the tag data stale; it's rebuilt
//   on the next read, in one pass.
// - Typing only rechecks the edited rows for #tags. It never touches tag data,
//   so typing in a big outline doesn't rebuild anything.
// - Listeners hear about a transaction only when something they show changed.

export type TagSnapshot = {
  /** Bumps whenever the tag data changes. */
  readonly version: number
  readonly rows: readonly IndexedRow[]
  readonly areas: readonly IndexedArea[]
}

function isClosedStatus(status: string | undefined): boolean {
  return status === 'done' || status === 'canceled'
}

function isPlainTextAt(row: Row, index: number): boolean {
  const text = row.text
  return !text.attributeAt('code', index, 'downstream') && !text.attributeAt('a', index, 'downstream')
}

/** Inline #tags a conversion would pick up: none in code rows, inline code or links. */
export function hashTagHits(row: Row): HashTagHit[] {
  if (row.type === 'code') return []
  const string = row.text.string
  if (string.indexOf('#') < 0) return []
  return findHashTags(string).filter((hit) => isPlainTextAt(row, hit.start))
}

export class TagIndex {
  readonly outline: Outline
  private snapshot?: TagSnapshot
  private version = 0
  /** Ids of top-level rows that hold tagged rows, from the last build. */
  private areaIds = new Set<number>()
  /** Ids of tagged rows, from the last build. */
  private taggedIds = new Set<number>()

  private hashRows?: Set<number>
  private hashPending = new Set<number>()
  private hashPrune = false

  private listeners = new Set<() => void>()
  private changed = false
  private observer: Disposable
  private closer: Disposable
  private dead = false

  constructor(outline: Outline, onClose: () => void) {
    this.outline = outline
    this.observer = outline.observeChanges((change) => {
      try {
        this.handle(change)
      } catch (error) {
        console.error('Tags: index update failed', error)
        this.invalidate()
      }
    })
    this.closer = outline.onClose(() => {
      this.dispose()
      onClose()
    })
  }

  get isDead(): boolean {
    return this.dead
  }

  dispose() {
    if (this.dead) return
    this.dead = true
    this.observer.dispose()
    this.closer.dispose()
    this.listeners.clear()
  }

  /** Called after any transaction that changed what Tags shows. */
  subscribe(listener: () => void): Disposable {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }

  /** Tagged rows and areas, rebuilt only when stale. */
  tags(): TagSnapshot {
    return (this.snapshot ??= this.build())
  }

  /** How many rows the Convert window would list. */
  hashTagRowCount(): number {
    if (!this.hashRows) {
      const rows = new Set<number>()
      for (const row of this.outline.root.descendants) if (hashTagHits(row).length > 0) rows.add(row.id)
      this.hashRows = rows
      this.hashPending.clear()
      this.hashPrune = false
    }
    this.settleHashRows()
    return this.hashRows.size
  }

  /** Drops everything cached; the next read starts over. */
  invalidate() {
    this.snapshot = undefined
    this.hashRows = undefined
    this.hashPending.clear()
    this.changed = true
  }

  private markTags() {
    if (this.snapshot) {
      this.snapshot = undefined
      this.changed = true
    }
  }

  private handle(change: OutlineChange) {
    switch (change.type) {
      case 'rowChanged': {
        const c = change.change
        if (c.type === 'setAttribute') {
          // A status change matters only on a tagged row.
          if (c.name === ATTR || (c.name === 'status' && this.taggedIds.has(change.rowId))) this.markTags()
        } else if (c.type === 'setType' || c.type === 'replacedText' || c.type === 'replacedTextAndSetType') {
          this.hashPending.add(change.rowId)
          // An area's name shows in the map.
          if (c.type !== 'setType' && this.areaIds.has(change.rowId)) this.markTags()
        }
        break
      }
      case 'siblingsInserted':
        this.markTags()
        if (this.hashRows) for (const row of change.siblings) for (const r of row.descendantsWithSelf) this.hashPending.add(r.id)
        break
      case 'siblingsRemoved':
        this.markTags()
        this.hashPrune = true
        break
      case 'siblingsMoved':
        // Moving rows can change their area.
        this.markTags()
        break
      case 'reload':
        // A reload may not close with endTransaction, so tell listeners now.
        this.invalidate()
        this.changed = false
        for (const listener of [...this.listeners]) listener()
        break
      case 'endTransaction':
        if (this.hashRows && (this.hashPending.size > 0 || this.hashPrune)) {
          const before = this.hashRows.size
          this.settleHashRows()
          if (this.hashRows.size !== before) this.changed = true
        }
        if (this.changed) {
          this.changed = false
          for (const listener of [...this.listeners]) listener()
        }
        break
    }
  }

  private settleHashRows() {
    const rows = this.hashRows
    if (!rows) return
    if (this.hashPrune) {
      for (const id of [...rows]) if (!this.outline.getRowById(id)) rows.delete(id)
      this.hashPrune = false
    }
    for (const id of this.hashPending) {
      const row = this.outline.getRowById(id)
      if (row && hashTagHits(row).length > 0) rows.add(id)
      else rows.delete(id)
    }
    this.hashPending.clear()
  }

  private build(): TagSnapshot {
    const root = this.outline.root
    const rootId = root.id
    const result = this.outline.query('//@tag')
    const found = result.type === 'elements' ? result.value : []
    // Each row's area comes from its parent's, so a branch's ancestors are read once.
    const areaOf = new Map<number, number | undefined>([[rootId, undefined]])
    const resolveArea = (row: Row): number | undefined => {
      const chain: Row[] = []
      let r: Row | undefined = row
      let area: number | undefined
      while (r) {
        const id = r.id
        if (areaOf.has(id)) {
          area = areaOf.get(id)
          break
        }
        const parent: Row | undefined = r.parent
        if (!parent || parent.id === rootId) {
          // r is top-level (or detached): it is its own area.
          area = parent ? id : undefined
          areaOf.set(id, area)
          break
        }
        chain.push(r)
        r = parent
      }
      for (const c of chain) areaOf.set(c.id, area)
      return area
    }

    const rows: IndexedRow[] = []
    for (const item of found) {
      const row = item as Row
      if (typeof row.getAttribute !== 'function') continue
      const tags = parseTags(row.getAttribute(ATTR))
      if (tags.length === 0) continue
      rows.push({ id: row.id, tags, closed: isClosedStatus(row.getAttribute('status')), area: resolveArea(row) })
    }

    const used = new Set<number>()
    for (const row of rows) if (row.area !== undefined) used.add(row.area)
    const areas: IndexedArea[] = []
    if (used.size > 0) {
      for (const child of root.children) {
        if (!used.has(child.id)) continue
        areas.push({ id: child.id, name: child.text.string.trim() })
      }
    }
    this.areaIds = used
    this.taggedIds = new Set(rows.map((r) => r.id))
    return { version: ++this.version, rows, areas }
  }
}

// MARK: - Registry

const indexes = new Map<string, TagIndex>()

/** The index for an outline, made on first use and dropped when the outline closes. */
export function indexFor(outline: Outline): TagIndex {
  const key = outline.root.ensurePersistentId()
  let index = indexes.get(key)
  if (index && !index.isDead) return index
  index = new TagIndex(outline, () => indexes.delete(key))
  indexes.set(key, index)
  return index
}

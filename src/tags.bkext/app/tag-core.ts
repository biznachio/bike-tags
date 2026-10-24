// Pure tag logic: no `bike` globals, so it runs (and is tested) anywhere.
//
// A row's tags live in ONE `tag` attribute as a comma list: "assignment, reading".
// The canonical form is lowercase, deduped, in the order written, joined by ", ".

export const TAG_ATTRIBUTE = 'tag'

/** One tag, cleaned: no #, no commas or quotes, spaces become dashes, lowercase. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .replace(/[",\\]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[-/]+|[-/]+$/g, '')
    .toLowerCase()
}

/** The tags in a wire value, cleaned and deduped, in written order. */
export function parseTags(wire: string | undefined | null): string[] {
  if (!wire) return []
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of wire.split(',')) {
    const tag = normalizeTag(part)
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      tags.push(tag)
    }
  }
  return tags
}

export function formatTags(tags: string[]): string {
  return tags.join(', ')
}

/** The canonical wire for any hand-typed value; empty when nothing usable remains. */
export function canonicalWire(wire: string | undefined | null): string {
  return formatTags(parseTags(wire))
}

export function withTags(wire: string | undefined, add: string[]): string {
  return formatTags(parseTags(formatTags([...parseTags(wire), ...add.map(normalizeTag)])))
}

export function withoutTags(wire: string | undefined, remove: string[]): string {
  const drop = new Set(remove.map(normalizeTag))
  return formatTags(parseTags(wire).filter((tag) => !drop.has(tag)))
}

/** Renames `from` to `to` in place; merges when the row already has `to`. */
export function renamedTag(wire: string | undefined, from: string, to: string): string {
  const f = normalizeTag(from)
  const t = normalizeTag(to)
  return formatTags(parseTags(formatTags(parseTags(wire).map((tag) => (tag === f ? t : tag)))))
}

/**
 * Rows carrying `tag`, as plain string tests on the canonical list, so it
 * needs no regex or list support from the query language. The variants
 * without a space also catch a hand-typed value the reconcile rule hasn't
 * canonicalized (pasted rows, for instance).
 */
export function tagFilterPath(tag: string): string {
  return `//${tagPredicate(tag)}`
}

/** The row test behind `tagFilterPath`, without the `//` step. */
export function tagPredicate(tag: string): string {
  const t = normalizeTag(tag)
  const q = (s: string) => `"${s}"`
  return [
    `@tag = ${q(t)}`,
    `@tag beginswith ${q(t + ',')}`,
    `@tag endswith ${q(', ' + t)}`,
    `@tag endswith ${q(',' + t)}`,
    `@tag contains ${q(', ' + t + ',')}`,
    `@tag contains ${q(',' + t + ',')}`,
  ].join(' or ')
}

export interface TagCount {
  name: string
  count: number
  /** Rows carrying the tag that aren't done or canceled. */
  open?: number
}

/** Tag → number of rows carrying it, sorted by name. */
export function countTags(wires: Iterable<string | undefined>): TagCount[] {
  const counts = new Map<string, number>()
  for (const wire of wires) {
    for (const tag of parseTags(wire)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Like `countTags`, plus how many of each tag's rows are still open. */
export function countTagsWithOpen(rows: Iterable<{ wire: string | undefined; closed: boolean }>): Required<TagCount>[] {
  const counts = new Map<string, { count: number; open: number }>()
  for (const { wire, closed } of rows) {
    for (const tag of parseTags(wire)) {
      const c = counts.get(tag) ?? { count: 0, open: 0 }
      c.count += 1
      if (!closed) c.open += 1
      counts.set(tag, c)
    }
  }
  return [...counts.entries()]
    .map(([name, c]) => ({ name, count: c.count, open: c.open }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// MARK: - Combined filters

const OPEN_ONLY = 'not (@status = done or @status = canceled)'

/**
 * Rows carrying every tag in `tags` (all, not any), optionally leaving out
 * done and canceled rows.
 */
export function combinedFilterPath(tags: readonly string[], hideDone: boolean): string {
  const parts = ['//@tag', ...tags.map((t) => `(${tagPredicate(t)})`)]
  if (hideDone) parts.push(`(${OPEN_ONLY})`)
  return parts.join(' and ')
}

/** The filter field label for a combined filter: "#a + #b". */
export function filterLabel(tags: readonly string[]): string {
  return tags.map((t) => `#${t}`).join(' + ')
}

/** Tags back out of a `filterLabel`, or undefined when the label isn't one. */
export function parseFilterLabel(label: string | undefined): string[] | undefined {
  if (!label || !label.startsWith('#')) return undefined
  const tags = label.split(' + ').map((part) => part.replace(/^#/, ''))
  return tags.every((t) => t === normalizeTag(t) && t !== '') ? tags : undefined
}

/**
 * The tags a badge draws before folding the rest into "+N". Active
 * (filtered) tags always stay visible, so the reason a row is showing is
 * never hidden.
 */
export function visibleTags(tags: string[], active: readonly string[], max: number): { shown: string[]; hidden: number } {
  if (tags.length <= max) return { shown: tags, hidden: 0 }
  const pinned = tags.filter((t) => active.includes(t)).slice(0, max)
  const rest = tags.filter((t) => !pinned.includes(t)).slice(0, max - pinned.length)
  const keep = new Set([...pinned, ...rest])
  const shown = tags.filter((t) => keep.has(t))
  return { shown, hidden: tags.length - shown.length }
}

/** Fuzzy-ish match for suggestions: prefix first, then anywhere. */
export function rankTags(all: TagCount[], typed: string, exclude: Set<string>): TagCount[] {
  const p = normalizeTag(typed)
  const pool = all.filter((t) => !exclude.has(t.name))
  if (!p) return [...pool].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  const prefix = pool.filter((t) => t.name.startsWith(p))
  const inner = pool.filter((t) => !t.name.startsWith(p) && t.name.includes(p))
  const byCount = (a: TagCount, b: TagCount) => b.count - a.count || a.name.localeCompare(b.name)
  return [...prefix.sort(byCount), ...inner.sort(byCount)]
}

/** Splits an in-progress list ("reading, as") into what's settled and what's being typed. */
export function splitTyping(text: string): { head: string; partial: string } {
  const i = text.lastIndexOf(',')
  return i < 0 ? { head: '', partial: text } : { head: text.slice(0, i + 1), partial: text.slice(i + 1) }
}

// MARK: - Inline #tags (for Convert)

export interface HashTagHit {
  start: number
  end: number
  name: string
}

// A # that starts a word (so C#, URL anchors and &#38; don't count), then a
// letter, digit or underscore, then letters, digits, _ - /. At least one
// letter, so "#1" and "#2026" stay text.
const HASH_TAG = /(^|[^\p{L}\p{N}_&/#])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*)/gu

export function findHashTags(text: string): HashTagHit[] {
  const hits: HashTagHit[] = []
  HASH_TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HASH_TAG.exec(text))) {
    let body = m[2].replace(/[-/]+$/, '')
    if (!/\p{L}/u.test(body)) continue
    const start = m.index + m[1].length
    hits.push({ start, end: start + 1 + body.length, name: normalizeTag(body) })
  }
  return hits
}

/**
 * The ranges to delete, in order, to lift `hits` out of `text` without
 * leaving doubled or dangling spaces. Each range is in the coordinates of the
 * string as it stands after the previous deletions (back to front, so earlier
 * ranges never shift).
 */
export function removalRanges(text: string, hits: HashTagHit[]): [number, number][] {
  const ranges: [number, number][] = []
  let s = text
  const del = (a: number, b: number) => {
    if (b <= a) return
    ranges.push([a, b])
    s = s.slice(0, a) + s.slice(b)
  }
  for (const hit of [...hits].sort((a, b) => b.start - a.start)) {
    let a = hit.start
    let b = hit.end
    if (a > 0 && s[a - 1] === ' ') a -= 1
    else if (s[b] === ' ') b += 1
    del(a, b)
    // "(#waiting)" leaves "()": take the empty brackets and their space too.
    const pair = s.slice(a - 1, a + 1)
    if (a > 0 && (pair === '()' || pair === '[]')) {
      const lead = a > 1 && s[a - 2] === ' ' ? 1 : 0
      del(a - 1 - lead, a + 1)
    }
  }
  const trailing = s.length - s.replace(/\s+$/, '').length
  if (trailing) del(s.length - trailing, s.length)
  const leading = s.length - s.replace(/^\s+/, '').length
  if (leading) del(0, leading)
  return ranges
}

/** What the text becomes once `removalRanges` runs (previews and tests). */
export function applyRemoval(text: string, ranges: [number, number][]): string {
  let s = text
  for (const [a, b] of ranges) s = s.slice(0, a) + s.slice(b)
  return s
}

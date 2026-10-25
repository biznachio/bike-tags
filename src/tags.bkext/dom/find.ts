// Pure helpers for the find field. No Bike imports, so Node can test them.

export type FindTag = { name: string; count: number; open: number }

/** What the user typed, as a tag: trimmed, lowercase, without a leading #. */
export function cleanQuery(query: string): string {
  return query.trim().replace(/^#/, '').toLowerCase()
}

/** Tags whose name contains the query, in their original order. */
export function findTags<T extends FindTag>(tags: T[], query: string): T[] {
  const q = cleanQuery(query)
  return q ? tags.filter((t) => t.name.includes(q)) : tags
}

/**
 * The tag Return adds. The most-used tag that starts with the query wins;
 * otherwise the most-used tag that contains it. Tags the caller can't add
 * (already in the filter, or faded) are skipped.
 */
export function topMatch<T extends FindTag>(tags: T[], query: string, hideDone: boolean, canAdd: (name: string) => boolean): T | undefined {
  const q = cleanQuery(query)
  if (!q) return undefined
  const uses = (t: T) => (hideDone ? t.open : t.count)
  const best = (list: T[]) => list.filter((t) => canAdd(t.name)).sort((a, b) => uses(b) - uses(a) || a.name.localeCompare(b.name))[0]
  return best(tags.filter((t) => t.name.startsWith(q))) ?? best(tags.filter((t) => t.name.includes(q)))
}

/** The gray text after the cursor: the rest of the top match, when it starts with the query. */
export function completionFor(match: FindTag | undefined, query: string): string {
  const q = cleanQuery(query)
  if (!match || !q || !match.name.startsWith(q)) return ''
  // Only complete when the typed text ends where the query ends (no trailing space).
  if (query.replace(/^\s*#?/, '').length !== q.length) return ''
  return match.name.slice(q.length)
}

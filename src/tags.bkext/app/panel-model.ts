// What the inspector shows, computed from plain data. No Bike imports, so
// Node can test it. The bridge-facing side lives in tag-index.ts.

import type { TagCount } from './tag-core'

/** One tagged row, read once from the outline. */
export type IndexedRow = {
  id: number
  tags: readonly string[]
  /** Done or canceled. */
  closed: boolean
  /** The top-level row it sits under (itself, at the top level). */
  area?: number
}

/** A top-level row that holds tagged rows, in outline order. */
export type IndexedArea = { id: number; name: string }

export type MapColumn = { id: string; name: string; full?: string }

/** Counts per tag, alphabetical. With `hideDone`, closed rows drop out first. */
export function tagStats(rows: readonly IndexedRow[], hideDone: boolean): Required<TagCount>[] {
  const counts = new Map<string, { count: number; open: number }>()
  for (const row of rows) {
    if (hideDone && row.closed) continue
    for (const tag of row.tags) {
      const c = counts.get(tag)
      if (c) {
        c.count++
        if (!row.closed) c.open++
      } else counts.set(tag, { count: 1, open: row.closed ? 0 : 1 })
    }
  }
  return [...counts.entries()].map(([name, c]) => ({ name, count: c.count, open: c.open })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Rows carrying every one of `tags`, optionally within one area and without closed rows. */
export function rowsWithAll(rows: readonly IndexedRow[], tags: readonly string[], options: { area?: number; hideDone?: boolean } = {}): IndexedRow[] {
  return rows.filter(
    (row) =>
      (!options.hideDone || !row.closed) &&
      (options.area === undefined || row.area === options.area) &&
      tags.every((t) => row.tags.includes(t))
  )
}

/** For each tag not in `tags`: how many of `rows` also carry it. */
export function combinable(rows: readonly IndexedRow[], tags: readonly string[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows) {
    for (const tag of row.tags) if (!tags.includes(tag)) result[tag] = (result[tag] ?? 0) + 1
  }
  return result
}

/**
 * The map: tags against areas. The busiest `max` areas get their own columns,
 * in outline order; the rest share one. When only one area would be left
 * over, it gets its own column instead.
 */
export function heatmap(
  rows: readonly IndexedRow[],
  areas: readonly IndexedArea[],
  max: number,
  other: { id: string; label: (count: number) => string }
): { areas: MapColumn[]; cells: Record<string, number[]> } {
  const byArea = new Map<number, Map<string, number>>()
  const totals = new Map<number, number>()
  for (const row of rows) {
    if (row.area === undefined) continue
    let counts = byArea.get(row.area)
    if (!counts) byArea.set(row.area, (counts = new Map()))
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    totals.set(row.area, (totals.get(row.area) ?? 0) + 1)
  }
  const used = areas.filter((a) => byArea.has(a.id))
  const keep = used.length > max + 1 ? max : max + 1
  const busiest = new Set(
    [...used]
      .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
      .slice(0, keep)
      .map((a) => a.id)
  )
  const shown = used.filter((a) => busiest.has(a.id))
  const rest = used.filter((a) => !busiest.has(a.id))

  const columns: MapColumn[] = shown.map((a) => ({ id: String(a.id), name: a.name }))
  if (rest.length > 0) columns.push({ id: other.id, name: other.label(rest.length), full: rest.map((a) => a.name).join(', ') })

  const cells: Record<string, number[]> = {}
  const add = (column: number, counts: Map<string, number>) => {
    for (const [tag, n] of counts) {
      cells[tag] ??= columns.map(() => 0)
      cells[tag][column] += n
    }
  }
  shown.forEach((a, i) => add(i, byArea.get(a.id)!))
  for (const a of rest) add(columns.length - 1, byArea.get(a.id)!)
  return { areas: columns, cells }
}

/** Your most-used tags not in `exclude`, for one-click adds. */
export function suggestions(counts: readonly TagCount[], exclude: readonly string[], n: number): string[] {
  return counts
    .filter((t) => !exclude.includes(t.name))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, n)
    .map((t) => t.name)
}

/** Which tags are on every row, and which on only some. */
export function selectionTags(lists: readonly (readonly string[])[]): { all: string[]; some: string[] } {
  const union = [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b))
  const all = union.filter((t) => lists.every((l) => l.includes(t)))
  return { all, some: union.filter((t) => !all.includes(t)) }
}

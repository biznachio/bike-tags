import { DOMProtocol } from 'bike/core'

export type PanelTag = { name: string; count: number; open: number }

/** The selected rows, for the This row card. */
export type PanelSelection = {
  /** The row's text, or "3 rows" for several. */
  label: string
  /** Tags on every selected row. */
  all: string[]
  /** Tags on some, but not all, selected rows. */
  some: string[]
  /** Your most-used tags not already on every selected row, offered as one-click adds. */
  suggest: string[]
}

/** The combined filter, for the filter card. */
export type PanelFilter = {
  tags: string[]
  hideDone: boolean
  /** Set when the filter is narrowed to one area from the heatmap. */
  area?: { id: string; name: string }
  rows: number
  open: number
  /** For each tag not in the filter: how many matching rows also carry it. Missing means none. */
  combinable: Record<string, number>
}

/** The id of the map column that gathers every area past the busiest few. */
export const OTHER_AREAS = 'other'

export type PanelHeatmap = {
  /** `full` lists what a combined column holds. */
  areas: { id: string; name: string; full?: string }[]
  /** Tag name → count per area, in `areas` order. */
  cells: Record<string, number[]>
}

export type PanelState = {
  /** False when the window has no outline editor to read. */
  hasOutline: boolean
  /** The section-wide Hide done switch: done and canceled rows are left out of everything shown. */
  hideDone: boolean
  tags: PanelTag[]
  selection?: PanelSelection
  filter?: PanelFilter
  heatmap: PanelHeatmap
  /** Rows that still carry inline #tags in their text. */
  hashTagRows: number
}

export interface TagsProtocol extends DOMProtocol {
  toDOM: { type: 'state'; state: PanelState }
  toApp:
    | { type: 'ready' }
    /** Adds the tag to the filter, or takes it out if it's already in. */
    | { type: 'toggleFilterTag'; tag: string }
    | { type: 'removeFilterTag'; tag: string }
    | { type: 'clear' }
    | { type: 'hideDone'; value: boolean }
    | { type: 'heatCell'; tag: string; areaId: string }
    | { type: 'addRowTag'; tag: string }
    | { type: 'removeRowTag'; tag: string }
    | { type: 'rename'; tag: string }
    | { type: 'add' }
    | { type: 'convert' }
}

// MARK: - Convert sheet

export type ConvertItem = {
  id: number
  before: string
  after: string
  tags: string[]
}

export interface ConvertProtocol extends DOMProtocol {
  toDOM: { type: 'items'; items: ConvertItem[] }
  toApp: { type: 'ready' } | { type: 'convert'; ids: number[] } | { type: 'cancel' }
}

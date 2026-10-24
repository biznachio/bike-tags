import { DOMProtocol } from 'bike/core'

export type PanelTag = { name: string; count: number }

export type PanelState = {
  /** False when the window has no outline editor to read. */
  hasOutline: boolean
  tags: PanelTag[]
  /** The tag the editor is filtered to, if the filter is ours. */
  active?: string
  /** Rows that still carry inline #tags in their text. */
  hashTagRows: number
}

export interface TagsProtocol extends DOMProtocol {
  toDOM: { type: 'state'; state: PanelState }
  toApp:
    | { type: 'ready' }
    | { type: 'toggle'; tag: string }
    | { type: 'clear' }
    | { type: 'rename'; tag: string }
    | { type: 'add' }
    | { type: 'convert' }
}

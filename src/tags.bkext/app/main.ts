import {
  AppExtensionContext,
  AttributeChoice,
  BadgeEnvironment,
  Color,
  CommandContext,
  Disposable,
  DOMScriptHandle,
  Image,
  Insets,
  MenuItem,
  Outline,
  OutlineEditor,
  Row,
  SymbolConfiguration,
  Text,
  Window,
} from 'bike/app'
import {
  TAG_ATTRIBUTE as ATTR,
  TagCount,
  applyRemoval,
  canonicalWire,
  combinedFilterPath,
  countTags,
  countTagsWithOpen,
  filterLabel,
  findHashTags,
  normalizeTag,
  parseFilterLabel,
  parseTags,
  rankTags,
  removalRanges,
  renamedTag,
  splitTyping,
  tagFilterPath,
  visibleTags,
  withTags,
  withoutTags,
} from './tag-core'
import { ConvertProtocol, OTHER_AREAS, PanelFilter, PanelHeatmap, PanelSelection, PanelState, TagsProtocol } from '../dom/protocols'

// Tags: tags as one `tag` row attribute holding a comma list.
//
// Bike stores and queries the attribute; this extension draws one badge per
// tag, edits the list, filters by one or more tags, keeps hand-typed values
// canonical, lists tags in the inspector, and converts old inline #tags.

const BADGE = 'tags'
const MORE_KEY = '+more'
const MAX_PILLS = 3
const HIDE_DONE_KEY = 'hideDone'

/** The tags the frontmost editor is filtered to through this extension. */
let activeTags: string[] = []

export async function activate(_context: AppExtensionContext) {
  // Each step stands alone, so one failure can't take the rest down.
  safely('commands', registerCommands)
  safely('keybindings', registerKeybindings)
  safely('attribute', registerAttribute)
  safely('reconcile', registerReconcile)
  safely('badge', registerBadge)
  safely('inspector', registerInspector)
  safely('filter watch', watchFilter)
}

function safely(step: string, run: () => void) {
  try {
    run()
  } catch (error) {
    console.error(`Tags: ${step} failed`, error)
  }
}

// MARK: - Reading the outline

function rowsOf(outline: Outline, path: string): Row[] {
  const result = outline.query(path)
  if (result.type !== 'elements') return []
  return result.value.filter((item): item is Row => typeof (item as Row).getAttribute === 'function')
}

function taggedRows(outline: Outline): Row[] {
  return rowsOf(outline, '//@tag')
}

function isClosed(row: Row): boolean {
  const status = row.getAttribute('status')
  return status === 'done' || status === 'canceled'
}

function tagCounts(outline: Outline): TagCount[] {
  return countTags(taggedRows(outline).map((row) => row.getAttribute(ATTR)))
}

function rowsWithTag(outline: Outline, tag: string): Row[] {
  const t = normalizeTag(tag)
  // The query narrows; the parse confirms, so a loose string match never leaks in.
  return rowsOf(outline, tagFilterPath(t)).filter((row) => parseTags(row.getAttribute(ATTR)).includes(t))
}

/** Rows carrying every one of `tags`, done or not. */
function rowsWithAll(outline: Outline, tags: string[]): Row[] {
  return rowsOf(outline, combinedFilterPath(tags, false)).filter((row) => {
    const have = parseTags(row.getAttribute(ATTR))
    return tags.every((t) => have.includes(t))
  })
}

function tagsOn(rows: Row[]): string[] {
  const all = new Set<string>()
  for (const row of rows) for (const tag of parseTags(row.getAttribute(ATTR))) all.add(tag)
  return [...all].sort((a, b) => a.localeCompare(b))
}

/** The top-level row a row sits under (itself, at the top level). */
function areaOf(row: Row): Row | undefined {
  let r: Row | undefined = row
  while (r && r.parent && r.parent.parent) r = r.parent
  return r && r.parent ? r : undefined
}

function rowsLabel(count: number): string {
  return bike.localize('{count, plural, one {# row} other {# rows}}', { count })
}

function hideDone(): boolean {
  return bike.defaults.get(HIDE_DONE_KEY) === true
}

// MARK: - Attribute

function registerAttribute() {
  bike.attribute(ATTR, {
    type: 'text',
    title: bike.localize('Tags'),
    description: bike.localize('Tags for this row, separated by commas.'),
    placeholder: 'reading, idea',
    defaultBadge: false,
    metadata: { calendar: false },
    // Completes the tag being typed, keeping the ones already written.
    suggestions: (pattern) => {
      const editor = bike.frontmostOutlineEditor
      if (!editor) return []
      const { head, partial } = splitTyping(pattern)
      const settled = new Set(parseTags(head))
      return rankTags(tagCounts(editor.outline), partial, settled)
        .slice(0, 12)
        .map(
          (t): AttributeChoice => ({
            name: `#${t.name}`,
            value: canonicalWire(`${head} ${t.name}`),
            detail: rowsLabel(t.count),
          })
        )
    },
  })
}

// Hand edits ("Reading,idea , reading") settle to "reading, idea" in the same
// undo step. An emptied list removes the attribute.
function registerReconcile() {
  bike.reconcile('tags:canonical', {
    when: { modified: { attribute: ATTR } },
    reconcile(outline, changes) {
      for (const change of changes) {
        if (change.type !== 'rowChanged') continue
        if (change.change.type !== 'setAttribute' || change.change.name !== ATTR) continue
        const row = outline.getRowById(change.rowId)
        const wire = row?.getAttribute(ATTR)
        if (!row || wire == null) continue
        const canonical = canonicalWire(wire)
        if (canonical === '') row.removeAttribute(ATTR)
        else if (canonical !== wire) row.setAttribute(ATTR, canonical)
      }
    },
  })
}

// MARK: - Badge

// Tag badges: a tag.fill symbol and the name in a rounded box with a soft
// slate fill and a stroke in the same hue. Colors come from the active theme,
// so light and dark resolve on their own; a theme can override any of the
// four by defining `tag-fill`, `tag-stroke`, `tag-text` or `tag-icon`.

type BadgeMode = 'rest' | 'active' | 'closed'

type BadgeColors = { fill: Color; stroke?: Color; ink: Color; icon: Color }

/** A cool blue-gray, mixed into the theme's own background and text. Made lazily, never at load. */
let slate: Color | undefined
function SLATE(): Color {
  return (slate ??= Color.oklch(0.6, 0.05, 262))
}

function badgeColors(env: BadgeEnvironment, mode: BadgeMode): BadgeColors {
  const colors = env.theme.colors
  if (mode === 'active') {
    // Solid accent with white text, as in the Tags inspector.
    const accent = colors.accent
    return { fill: accent, ink: Color.white(), icon: Color.white().mixed(accent, 0.15) }
  }
  const base: Required<BadgeColors> = {
    fill: colors.get('tag-fill') ?? colors.background.mixed(SLATE(), 0.14),
    stroke: colors.get('tag-stroke') ?? colors.background.mixed(SLATE(), 0.38),
    ink: colors.get('tag-text') ?? colors.text.mixed(SLATE(), 0.32),
    icon: colors.get('tag-icon') ?? colors.text.mixed(SLATE(), 0.62),
  }
  if (mode === 'rest') return base
  // Done rows: blend halfway to the background rather than going
  // translucent, so nothing Bike draws behind badges shows through.
  const bg = colors.background
  return {
    fill: base.fill.mixed(bg, 0.5),
    stroke: base.stroke.mixed(bg, 0.5),
    ink: base.ink.mixed(bg, 0.5),
    icon: base.icon.mixed(bg, 0.5),
  }
}

function tagBox(env: BadgeEnvironment, content: Image, c: BadgeColors): Image {
  const bm = env.badgeMetrics
  const p = bm.padding
  return content.withBackground({
    fill: c.fill,
    // The filtered tag has no border; it would only match the fill.
    stroke: c.stroke,
    strokeWidth: bm.strokeWidth,
    // Bike's own badge radius, so the tag lines up with the match highlight
    // Bike draws behind badges while filtering.
    cornerRadius: bm.cornerRadius,
    padding: new Insets(p.top, p.right + 2, p.bottom, p.left + 1),
  })
}

function pill(env: BadgeEnvironment, tag: string, mode: BadgeMode): Image {
  const c = badgeColors(env, mode)
  // Regular weight in every state, so filtering changes color, not heft.
  const font = env.font.withPointSize(env.badgeMetrics.fontSize)
  const symbol = Image.fromSymbol(new SymbolConfiguration('tag.fill').withFont(font).withSymbolScale('small').withPaletteColors([c.icon]))
  return tagBox(env, symbol.withHStack(Image.fromText(new Text(tag, font, c.ink)), 3), c)
}

/** The overflow count: same box, no symbol, so it reads as a number. */
function morePill(env: BadgeEnvironment, hidden: number, closed: boolean): Image {
  const c = badgeColors(env, closed ? 'closed' : 'rest')
  const font = env.font.withPointSize(env.badgeMetrics.fontSize)
  return tagBox(env, Image.fromText(new Text(`+${hidden}`, font, c.ink)), c)
}

let badge: Disposable | undefined

/** Re-registered when the active tags change, so their badges repaint. */
function registerBadge() {
  const active = [...activeTags]
  badge?.dispose()
  badge = bike.badge(BADGE, {
    where: '.@tag',
    inputs: { tag: '@tag', status: '@status' },
    render: (values, env) => {
      const tags = parseTags(values['tag'])
      if (tags.length === 0) return null
      const closed = values['status'] === 'done' || values['status'] === 'canceled'
      const { shown, hidden } = visibleTags(tags, active, MAX_PILLS)
      const images = shown.map((tag) => ({
        key: tag,
        image: pill(env, tag, active.includes(tag) ? 'active' : closed ? 'closed' : 'rest'),
      }))
      if (hidden > 0) images.push({ key: MORE_KEY, image: morePill(env, hidden, closed) })
      return images
    },
    onClick: ({ editor, row, key }) => showPillMenu(editor, row, key),
  })
}

function showPillMenu(editor: OutlineEditor, row: Row, key?: string) {
  const tags = parseTags(row.getAttribute(ATTR))
  const placement = { row, anchor: { badge: BADGE, key } }

  if (!key || key === MORE_KEY) {
    const items: MenuItem[] = [
      ...tags.map(
        (tag): MenuItem => ({
          type: 'button',
          id: `show:${tag}`,
          title: `#${tag}`,
          symbol: 'tag',
          state: activeTags.includes(tag) ? 'on' : 'off',
        })
      ),
      { type: 'separator' },
      { type: 'button', id: 'add', title: bike.localize('Add Tag…'), symbol: 'plus' },
    ]
    editor.showMenu(placement, {
      items,
      onAction: (id) => {
        if (id === 'add') addTagToRows(editor, [row])
        else if (id.startsWith('show:')) filterBy(editor, id.slice(5), false)
      },
    })
    return
  }

  const tag = key
  const current = currentFilter(editor)?.tags ?? []
  const only = current.length === 1 && current[0] === tag
  const items: MenuItem[] = [
    {
      type: 'button',
      id: 'toggle',
      title: only ? bike.localize('Clear Tag Filter') : bike.localize('Show Rows Tagged #{tag}', { tag }),
      symbol: only ? 'xmark.circle' : 'line.3.horizontal.decrease',
    },
  ]
  if (current.length > 0 && !current.includes(tag)) {
    items.push({ type: 'button', id: 'extend', title: bike.localize('Add #{tag} to Filter', { tag }), symbol: 'plus.circle' })
  }
  items.push(
    { type: 'button', id: 'remove', title: bike.localize('Remove from This Row'), symbol: 'minus.circle' },
    { type: 'separator' },
    { type: 'button', id: 'rename', title: bike.localize('Rename #{tag} Everywhere…', { tag }), symbol: 'pencil' },
    { type: 'button', id: 'add', title: bike.localize('Add Tag…'), symbol: 'plus' }
  )
  editor.showMenu(placement, {
    items,
    onAction: (id) => {
      if (id === 'toggle') filterBy(editor, tag, false)
      else if (id === 'extend') filterBy(editor, tag, true)
      else if (id === 'remove') removeTagsFromRows(editor, [row], [tag])
      else if (id === 'rename') renameTagFlow(editor, tag)
      else if (id === 'add') addTagToRows(editor, [row])
    },
  })
}

// MARK: - Filtering

type FilterState = { tags: string[]; hideDone: boolean; area?: Row }

/** The filter this editor shows, when it's one this extension set. */
function currentFilter(editor: OutlineEditor | undefined): FilterState | undefined {
  const filter = editor?.filter
  const tags = parseFilterLabel(filter?.label)
  if (!editor || !filter || !tags) return undefined
  for (const hd of [false, true]) {
    if (filter.path !== combinedFilterPath(tags, hd)) continue
    const focus = editor.focus
    const area = focus.parent && !focus.parent.parent ? focus : undefined
    return { tags, hideDone: hd, area }
  }
  return undefined
}

/**
 * Shows rows carrying all of `tags`, within `area` when given. An empty list
 * clears the filter and steps back out of the area.
 */
function applyFilter(editor: OutlineEditor, tags: string[], area?: Row) {
  const clean = [...new Set(tags.map(normalizeTag).filter(Boolean))]
  if (clean.length === 0) {
    const was = currentFilter(editor)
    editor.transaction({ label: bike.localize('Clear Tag Filter'), animate: { spring: 'navigation' } }, () => {
      if (was) editor.filter = undefined
      if (was?.area) editor.focus = editor.outline.root
    })
    setActive([])
    return
  }
  if (rowsWithAll(editor.outline, clean).length === 0) {
    editor.showStatusMessage(bike.localize('No rows are tagged {tags}', { tags: filterLabel(clean) }), 3)
    return
  }
  const label = filterLabel(clean)
  editor.transaction({ label: bike.localize('Show {tags}', { tags: label }), animate: { spring: 'navigation' } }, () => {
    editor.focus = area ?? editor.outline.root
    editor.filter = {
      path: combinedFilterPath(clean, hideDone()),
      label,
      emptyMessage: hideDone() ? bike.localize('No rows tagged {tags} are left once done rows are hidden', { tags: label }) : bike.localize('No rows are tagged {tags}', { tags: label }),
    }
  })
  setActive(clean)
  // Same tags with a different All rows / Open only choice doesn't change
  // the active set, so refresh explicitly.
  refreshPanels()
}

/**
 * A click on a tag: show just that tag, or clear when it's already the only
 * one. With `extend` (shift-click), add it to the filter or take it out.
 */
function filterBy(editor: OutlineEditor, tag: string, extend: boolean) {
  const t = normalizeTag(tag)
  const state = currentFilter(editor)
  const current = state?.tags ?? []
  if (extend) {
    const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t]
    applyFilter(editor, next, state?.area)
  } else {
    applyFilter(editor, current.length === 1 && current[0] === t ? [] : [t])
  }
}

function removeFromFilter(editor: OutlineEditor, tag: string) {
  const state = currentFilter(editor)
  if (!state) return
  applyFilter(editor, state.tags.filter((t) => t !== tag), state.area)
}

function setHideDone(editor: OutlineEditor | undefined, value: boolean) {
  bike.defaults.set(HIDE_DONE_KEY, value)
  const state = editor ? currentFilter(editor) : undefined
  if (editor && state) applyFilter(editor, state.tags, state.area)
  else refreshPanels()
}

function setActive(tags: string[]) {
  if (tags.join('\n') === activeTags.join('\n')) return
  activeTags = tags
  safely('badge', registerBadge)
  refreshPanels()
}

// Bike has no filter observer; a light poll notices when the filter is
// cleared or changed by other means (the filter field, Escape, navigation).
function watchFilter() {
  setInterval(() => setActive(currentFilter(bike.frontmostOutlineEditor)?.tags ?? []), 750)
  bike.observeFrontmostOutlineEditor((editor) => setActive(currentFilter(editor)?.tags ?? []))
}

// MARK: - Editing

function addTagsToRows(editor: OutlineEditor, rows: Row[], tags: string[]) {
  const clean = tags.map(normalizeTag).filter(Boolean)
  if (clean.length === 0 || rows.length === 0) return
  const label = clean.length === 1 ? bike.localize('Add Tag') : bike.localize('Add Tags')
  editor.outline.transaction({ label }, () => {
    for (const row of rows) {
      const next = withTags(row.getAttribute(ATTR), clean)
      if (next !== row.getAttribute(ATTR)) row.setAttribute(ATTR, next)
    }
  })
}

function removeTagsFromRows(editor: OutlineEditor, rows: Row[], tags: string[]) {
  editor.outline.transaction({ label: bike.localize('Remove Tag') }, () => {
    for (const row of rows) {
      const wire = row.getAttribute(ATTR)
      if (wire == null) continue
      const next = withoutTags(wire, tags)
      if (next === '') row.removeAttribute(ATTR)
      else if (next !== wire) row.setAttribute(ATTR, next)
    }
  })
}

/** The picker: type to filter your tags, or type a new one. Commas add several at once. */
function addTagToRows(editor: OutlineEditor, rows: Row[]) {
  if (rows.length === 0) return
  const all = tagCounts(editor.outline)
  // With one row, hide what it already has; with several, offer everything.
  const already = new Set(rows.length === 1 ? parseTags(rows[0].getAttribute(ATTR)) : [])
  const known = new Set(all.map((t) => t.name))
  editor.showPicker(
    { row: rows[0] },
    {
      label: rows.length === 1 ? bike.localize('Add Tag') : bike.localize('Add Tag to {count} Rows', { count: rows.length }),
      source: {
        values: (pattern) => {
          const { head, partial } = splitTyping(pattern)
          const settled = new Set([...already, ...parseTags(head)])
          return rankTags(all, partial, settled)
            .slice(0, 30)
            .map((t) => ({
              name: `#${t.name}`,
              value: canonicalWire(`${head} ${t.name}`),
              detail: rowsLabel(t.count),
            }))
        },
        parse: (text) => {
          const tags = parseTags(text)
          if (tags.length === 0) return undefined
          const names = tags.map((t) => `#${t}`).join(' ')
          const creating = tags.some((t) => !known.has(t))
          return {
            value: tags.join(', '),
            label: creating ? bike.localize('Create {names}', { names }) : bike.localize('Add {names}', { names }),
          }
        },
      },
      onAccept: (value) => addTagsToRows(editor, rows, parseTags(value)),
    }
  )
}

function selectedRows({ editor, selection }: CommandContext): Row[] {
  if (!editor) return []
  return selection?.rows ?? editor.selection?.rows ?? []
}

async function chooseTag(placeholder: string, tags: TagCount[]): Promise<string | undefined> {
  if (tags.length === 0) return undefined
  const result = await bike.showChoiceBox(
    {
      placeholder,
      defaultSymbol: 'tag',
      items: tags.map((t) => ({ name: `#${t.name}`, container: rowsLabel(t.count) })),
    },
    bike.frontmostWindow
  )
  if (!result || result.indices.length === 0) return undefined
  return tags[result.indices[0]].name
}

async function renameTagFlow(editor: OutlineEditor, from: string) {
  const result = await bike.showAlert(
    {
      title: bike.localize('Rename #{tag}', { tag: from }),
      message: bike.localize('Renames the tag on every row. Renaming to a tag you already use merges the two.'),
      fields: [{ id: 'name', type: 'text', defaultValue: from, placeholder: 'tag-name' }],
      buttons: [bike.localize('Rename'), bike.localize('Cancel')],
    },
    bike.frontmostWindow
  )
  if (result.buttonIndex !== 0) return
  const to = normalizeTag(String(result.values['name'] ?? ''))
  if (!to || to === from) return
  const state = currentFilter(editor)
  const rows = rowsWithTag(editor.outline, from)
  editor.outline.transaction({ label: bike.localize('Rename Tag') }, () => {
    for (const row of rows) row.setAttribute(ATTR, renamedTag(row.getAttribute(ATTR), from, to))
  })
  editor.showStatusMessage(bike.localize('Renamed #{from} to #{to} on {rows}', { from, to, rows: rowsLabel(rows.length) }), 3)
  if (state && state.tags.includes(from)) applyFilter(editor, state.tags.map((t) => (t === from ? to : t)), state.area)
  else refreshPanels()
}

// MARK: - Convert #tags

type ConversionRow = { row: Row; hits: ReturnType<typeof findHashTags> }

function isPlainTextAt(row: Row, index: number): boolean {
  const text = row.text
  return !text.attributeAt('code', index, 'downstream') && !text.attributeAt('a', index, 'downstream')
}

function hitsFor(row: Row): ConversionRow['hits'] {
  if (row.type === 'code') return []
  const string = row.text.string
  if (string.indexOf('#') < 0) return []
  // Skip #words inside inline code or links.
  return findHashTags(string).filter((hit) => isPlainTextAt(row, hit.start))
}

function planConversion(outline: Outline): ConversionRow[] {
  const plan: ConversionRow[] = []
  for (const row of outline.root.descendants) {
    const hits = hitsFor(row)
    if (hits.length > 0) plan.push({ row, hits })
  }
  return plan
}

/** Rows the Convert window would list: the same rule, so the notice and the window agree. */
function countHashTagRows(outline: Outline): number {
  let count = 0
  for (const row of outline.root.descendants) if (hitsFor(row).length > 0) count++
  return count
}

/** Converts the given rows, reading their text fresh so edits made meanwhile are respected. */
function convertRows(editor: OutlineEditor, rows: Row[]): number {
  let converted = 0
  editor.outline.transaction({ label: bike.localize('Convert #tags') }, () => {
    for (const row of rows) {
      const hits = hitsFor(row)
      if (hits.length === 0) continue
      // Edit a copy, then assign it. `row.text` is the row's live text, and
      // assigning it back to itself crashes Bike (a Swift exclusivity conflict).
      const live = row.text
      const text = live.substring([0, live.count])
      for (const range of removalRanges(text.string, hits)) text.delete(range)
      row.text = text
      row.setAttribute(ATTR, withTags(row.getAttribute(ATTR), hits.map((h) => h.name)))
      converted++
    }
  })
  return converted
}

/** Opens the Convert window: every row with inline #tags, each with a checkbox. */
async function convertCommand({ editor }: CommandContext): Promise<boolean> {
  if (!editor) return false
  const plan = planConversion(editor.outline)
  if (plan.length === 0) {
    editor.showStatusMessage(bike.localize('No row text in this outline has #tags'), 3)
    return true
  }
  const window = bike.frontmostWindow
  if (!window) return false
  const handle = await window.presentSheet<ConvertProtocol>('ConvertSheet.js', { width: 640, height: 560 })
  handle.onmessage = (message) => {
    switch (message.type) {
      case 'ready':
        handle.postMessage({
          type: 'items',
          items: plan.map(({ row, hits }) => {
            const before = row.text.string
            return {
              id: row.id,
              before,
              after: applyRemoval(before, removalRanges(before, hits)),
              tags: [...new Set(hits.map((h) => h.name))],
            }
          }),
        })
        break
      // Closing the sheet or editing the outline from inside the sheet's own
      // message delivery crashes Bike (a Swift exclusivity conflict), so both
      // wait for the next tick, after the delivery has finished.
      case 'convert': {
        const ids = [...message.ids]
        setTimeout(() => {
          handle.dispose()
          setTimeout(() => {
            const rows = ids.map((id) => editor.outline.getRowById(id)).filter((row): row is Row => !!row)
            const n = convertRows(editor, rows)
            editor.showStatusMessage(bike.localize('Converted {rows}', { rows: rowsLabel(n) }), 4)
            refreshPanels()
          }, 0)
        }, 0)
        break
      }
      case 'cancel':
        setTimeout(() => handle.dispose(), 0)
        break
    }
  }
  return true
}

// MARK: - Commands

function registerCommands() {
  bike.commands.addCommands({
    commands: {
      'tags:add-tag': {
        button: { symbol: 'tag', location: 'toolbar' },
        action: (context) => {
          const rows = selectedRows(context)
          if (!context.editor || rows.length === 0) return false
          addTagToRows(context.editor, rows)
          return true
        },
      },
      'tags:remove-tag': (context) => {
        const editor = context.editor
        const rows = selectedRows(context)
        if (!editor || rows.length === 0) return false
        const present = tagsOn(rows)
        if (present.length === 0) {
          editor.showStatusMessage(bike.localize('No tags on the selected rows'), 2)
          return true
        }
        if (present.length === 1) {
          removeTagsFromRows(editor, rows, present)
          return true
        }
        editor.showPicker(
          { row: rows[0], anchor: { badge: BADGE } },
          {
            label: bike.localize('Remove Tag'),
            source: { values: present.map((tag) => ({ name: `#${tag}`, value: tag })), strict: true },
            onAccept: (tag) => removeTagsFromRows(editor, rows, [tag]),
          }
        )
        return true
      },
      'tags:show-tag': ({ editor }) => {
        if (!editor) return false
        const tags = tagCounts(editor.outline)
        if (tags.length === 0) {
          editor.showStatusMessage(bike.localize('No tags in this outline'), 2)
          return true
        }
        chooseTag(bike.localize('Show rows tagged…'), tags).then((tag) => {
          if (tag) applyFilter(editor, [tag])
        })
        return true
      },
      'tags:clear-tag-filter': ({ editor }) => {
        if (!editor || !currentFilter(editor)) return false
        applyFilter(editor, [])
        return true
      },
      'tags:rename-tag': ({ editor }) => {
        if (!editor) return false
        const tags = tagCounts(editor.outline)
        if (tags.length === 0) {
          editor.showStatusMessage(bike.localize('No tags in this outline'), 2)
          return true
        }
        chooseTag(bike.localize('Rename which tag?'), tags).then((tag) => {
          if (tag) renameTagFlow(editor, tag)
        })
        return true
      },
      'tags:convert-hash-tags': convertCommand,
    },
  })
}

function registerKeybindings() {
  for (const keymap of ['text-mode', 'block-mode'] as const) {
    bike.keybindings.addKeybindings({
      keymap,
      keybindings: { 'cmd-shift-t': 'tags:add-tag' },
    })
  }
}

// MARK: - Inspector

type PanelEntry = {
  window: Window
  handle: DOMScriptHandle<TagsProtocol>
  /** The watched outline, by its root's persistent id (Row objects never compare equal). */
  outlineKey?: string
  watches: Disposable[]
  timer?: number
}

const panels = new Set<PanelEntry>()

function registerInspector() {
  bike.observeWindows(async (window) => {
    const handle = await window.inspector.addItem<TagsProtocol>({
      id: 'tags',
      label: bike.localize('Tags'),
      script: 'TagsPanel.js',
    })
    const entry: PanelEntry = { window, handle, watches: [] }
    panels.add(entry)

    // Actions run on the next tick, after Bike finishes delivering the
    // message; editing from inside the delivery can trip Bike's exclusivity
    // checks (see the Convert window).
    handle.onmessage = (message) => setTimeout(() => handlePanelMessage(entry, message), 0)

    watchEditor(entry)
    window.observeCurrentOutlineEditor(() => watchEditor(entry))
    window.onClose(() => {
      for (const w of entry.watches) w.dispose()
      panels.delete(entry)
    })
  })
}

function handlePanelMessage(entry: PanelEntry, message: TagsProtocol['toApp']) {
  const window = entry.window
  const editor = window.currentOutlineEditor
  if (message.type === 'ready') return push(entry)
  if (!editor) return
  const rows = editor.selection?.rows ?? []
  switch (message.type) {
    case 'toggleFilterTag':
      filterBy(editor, message.tag, true)
      break
    case 'removeFilterTag':
      removeFromFilter(editor, message.tag)
      break
    case 'clear':
      applyFilter(editor, [])
      break
    case 'hideDone':
      setHideDone(editor, message.value)
      break
    case 'heatCell': {
      // The combined "more" column has no single area to step into.
      const area = message.areaId === OTHER_AREAS ? undefined : editor.outline.getRowById(Number(message.areaId))
      applyFilter(editor, [message.tag], area)
      break
    }
    case 'addRowTag':
      addTagsToRows(editor, rows, [message.tag])
      break
    case 'removeRowTag':
      removeTagsFromRows(editor, rows, [message.tag])
      break
    case 'rename':
      renameTagFlow(editor, message.tag)
      break
    case 'add':
      if (rows.length === 0) editor.showStatusMessage(bike.localize('Select a row to tag'), 2)
      else addTagToRows(editor, rows)
      break
    case 'convert':
      convertCommand({ editor })
      break
  }
}

/** Follows the window's current editor: its outline's edits and its selection. */
function watchEditor(entry: PanelEntry) {
  const editor = entry.window.currentOutlineEditor
  const key = editor?.outline.root.ensurePersistentId()
  if (key && key === entry.outlineKey && entry.watches.length > 0) return
  for (const w of entry.watches) w.dispose()
  entry.watches = []
  entry.outlineKey = key
  if (editor) {
    entry.watches.push(
      editor.outline.observeChanges((change) => {
        if (change.type === 'endTransaction' || change.type === 'reload') schedulePush(entry, 400)
      }),
      editor.observeSelection(() => schedulePush(entry, 0), 150)
    )
  }
  push(entry)
}

function schedulePush(entry: PanelEntry, delay: number) {
  if (entry.timer !== undefined) clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    entry.timer = undefined
    push(entry)
  }, delay)
}

const SUGGESTIONS = 3

function selectionState(editor: OutlineEditor, counts: TagCount[]): PanelSelection | undefined {
  const rows = editor.selection?.rows ?? []
  if (rows.length === 0) return undefined
  const lists = rows.map((row) => parseTags(row.getAttribute(ATTR)))
  const union = [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b))
  const all = union.filter((t) => lists.every((l) => l.includes(t)))
  const some = union.filter((t) => !all.includes(t))
  const text = rows[0].text.string.trim()
  const suggest = [...counts]
    .filter((t) => !all.includes(t.name))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, SUGGESTIONS)
    .map((t) => t.name)
  return {
    label: rows.length === 1 ? text || bike.localize('Untitled row') : rowsLabel(rows.length),
    all,
    some,
    suggest,
  }
}

function filterState(editor: OutlineEditor): PanelFilter | undefined {
  const state = currentFilter(editor)
  if (!state) return undefined
  let rows = rowsWithAll(editor.outline, state.tags)
  if (state.hideDone) rows = rows.filter((row) => !isClosed(row))
  const area = state.area
  if (area) rows = rows.filter((row) => areaOf(row)?.id === area.id)
  // Which other tags could still narrow this filter, and by how much.
  const combinable: Record<string, number> = {}
  for (const row of rows) {
    for (const tag of parseTags(row.getAttribute(ATTR))) {
      if (!state.tags.includes(tag)) combinable[tag] = (combinable[tag] ?? 0) + 1
    }
  }
  return {
    combinable,
    tags: state.tags,
    hideDone: state.hideDone,
    area: state.area ? { id: String(state.area.id), name: state.area.text.string.trim() || bike.localize('Untitled') } : undefined,
    rows: rows.length,
    open: rows.filter((row) => !isClosed(row)).length,
  }
}

const MAP_AREAS = 4

function heatmapState(outline: Outline, rows: Row[]): PanelHeatmap {
  // Keyed by row id: Bike hands out a fresh Row object on every read, so
  // objects never compare equal.
  const byArea = new Map<number, Map<string, number>>()
  const totals = new Map<number, number>()
  for (const row of rows) {
    const area = areaOf(row)
    if (!area) continue
    const counts = byArea.get(area.id) ?? new Map<string, number>()
    for (const tag of parseTags(row.getAttribute(ATTR))) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    byArea.set(area.id, counts)
    totals.set(area.id, (totals.get(area.id) ?? 0) + 1)
  }
  // The busiest few areas get their own columns, in outline order; the rest
  // share one, so the map always fits the inspector.
  const used = outline.root.children.filter((row) => byArea.has(row.id))
  const busiest = new Set(
    [...used]
      .sort((a, b) => (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0))
      .slice(0, used.length > MAP_AREAS + 1 ? MAP_AREAS : MAP_AREAS + 1)
      .map((row) => row.id)
  )
  const shown = used.filter((row) => busiest.has(row.id))
  const rest = used.filter((row) => !busiest.has(row.id))
  const name = (row: Row) => row.text.string.trim() || bike.localize('Untitled')

  const columns: PanelHeatmap['areas'] = shown.map((row) => ({ id: String(row.id), name: name(row) }))
  if (rest.length > 0) {
    columns.push({
      id: OTHER_AREAS,
      name: bike.localize('+{count} more', { count: rest.length }),
      full: rest.map(name).join(', '),
    })
  }
  const cells: Record<string, number[]> = {}
  const add = (column: number, counts: Map<string, number>) => {
    for (const [tag, n] of counts) {
      cells[tag] ??= columns.map(() => 0)
      cells[tag][column] += n
    }
  }
  shown.forEach((row, i) => add(i, byArea.get(row.id)!))
  for (const row of rest) add(columns.length - 1, byArea.get(row.id)!)
  return { areas: columns, cells }
}

function push(entry: PanelEntry) {
  const editor = entry.window.currentOutlineEditor
  let state: PanelState
  if (!editor) {
    state = { hasOutline: false, hideDone: hideDone(), tags: [], heatmap: { areas: [], cells: {} }, hashTagRows: 0 }
  } else {
    // With Hide done on, done and canceled rows drop out of everything the
    // panel shows: counts, bars, the map, suggestions and fading.
    const hide = hideDone()
    const rows = taggedRows(editor.outline).filter((row) => !hide || !isClosed(row))
    const tags = countTagsWithOpen(rows.map((row) => ({ wire: row.getAttribute(ATTR), closed: isClosed(row) })))
    state = {
      hasOutline: true,
      hideDone: hide,
      tags,
      selection: selectionState(editor, tags),
      filter: filterState(editor),
      heatmap: heatmapState(editor.outline, rows),
      hashTagRows: countHashTagRows(editor.outline),
    }
  }
  try {
    entry.handle.postMessage({ type: 'state', state })
  } catch (error) {
    console.error('Tags: panel update failed', error)
  }
}

function refreshPanels() {
  for (const entry of panels) push(entry)
}

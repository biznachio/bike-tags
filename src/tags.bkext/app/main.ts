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
  countTags,
  findHashTags,
  normalizeTag,
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
import { PanelState, TagsProtocol } from '../dom/protocols'

// Tags: tags as one `tag` row attribute holding a comma list.
//
// Bike stores and queries the attribute; this extension draws one pill per
// tag, edits the list, filters by a single tag, keeps hand-typed values
// canonical, lists tags in the inspector, and converts old inline #tags.

const BADGE = 'tags'
const MORE_KEY = '+more'
const MAX_PILLS = 3

/** The tag the frontmost editor is filtered to through this extension, if any. */
let activeTag: string | undefined

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

function tagCounts(outline: Outline): TagCount[] {
  return countTags(taggedRows(outline).map((row) => row.getAttribute(ATTR)))
}

function rowsWithTag(outline: Outline, tag: string): Row[] {
  const t = normalizeTag(tag)
  // The query narrows; the parse confirms, so a loose string match never leaks in.
  return rowsOf(outline, tagFilterPath(t)).filter((row) => parseTags(row.getAttribute(ATTR)).includes(t))
}

function tagsOn(rows: Row[]): string[] {
  const all = new Set<string>()
  for (const row of rows) for (const tag of parseTags(row.getAttribute(ATTR))) all.add(tag)
  return [...all].sort((a, b) => a.localeCompare(b))
}

function rowsLabel(count: number): string {
  return bike.localize('{count, plural, one {# row} other {# rows}}', { count })
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
// slate fill and a stroke in the same hue. Colors come from the active theme, so light and
// dark resolve on their own; a theme can override any of the four by
// defining `tag-fill`, `tag-stroke`, `tag-text` or `tag-icon`.

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
  const base = env.font.withPointSize(env.badgeMetrics.fontSize)
  // Regular weight in every state, so filtering changes color, not heft.
  const font = base
  const symbol = Image.fromSymbol(new SymbolConfiguration('tag.fill').withFont(base).withSymbolScale('small').withPaletteColors([c.icon]))
  return tagBox(env, symbol.withHStack(Image.fromText(new Text(tag, font, c.ink)), 3), c)
}

/** The overflow count: same box, no symbol, so it reads as a number. */
function morePill(env: BadgeEnvironment, hidden: number, closed: boolean): Image {
  const c = badgeColors(env, closed ? 'closed' : 'rest')
  const font = env.font.withPointSize(env.badgeMetrics.fontSize)
  return tagBox(env, Image.fromText(new Text(`+${hidden}`, font, c.ink)), c)
}

let badge: Disposable | undefined

/** Re-registered when the active tag changes, so its badges repaint. */
function registerBadge() {
  const active = activeTag
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
        image: pill(env, tag, tag === active ? 'active' : closed ? 'closed' : 'rest'),
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
          state: tag === activeTag ? 'on' : 'off',
        })
      ),
      { type: 'separator' },
      { type: 'button', id: 'add', title: bike.localize('Add Tag…'), symbol: 'plus' },
    ]
    editor.showMenu(placement, {
      items,
      onAction: (id) => {
        if (id === 'add') addTagToRows(editor, [row])
        else if (id.startsWith('show:')) toggleTag(editor, id.slice(5))
      },
    })
    return
  }

  const tag = key
  const isActive = tag === activeTag
  editor.showMenu(placement, {
    items: [
      {
        type: 'button',
        id: 'toggle',
        title: isActive ? bike.localize('Clear Tag Filter') : bike.localize('Show Rows Tagged #{tag}', { tag }),
        symbol: isActive ? 'xmark.circle' : 'line.3.horizontal.decrease',
      },
      { type: 'button', id: 'remove', title: bike.localize('Remove from This Row'), symbol: 'minus.circle' },
      { type: 'separator' },
      { type: 'button', id: 'rename', title: bike.localize('Rename #{tag} Everywhere…', { tag }), symbol: 'pencil' },
      { type: 'button', id: 'add', title: bike.localize('Add Tag…'), symbol: 'plus' },
    ],
    onAction: (id) => {
      if (id === 'toggle') toggleTag(editor, tag)
      else if (id === 'remove') removeTagsFromRows(editor, [row], [tag])
      else if (id === 'rename') renameTagFlow(editor, tag)
      else if (id === 'add') addTagToRows(editor, [row])
    },
  })
}

// MARK: - Filtering

function showTag(editor: OutlineEditor, tag: string) {
  const t = normalizeTag(tag)
  if (!t) return
  if (rowsWithTag(editor.outline, t).length === 0) {
    editor.showStatusMessage(bike.localize('No rows are tagged #{tag}', { tag: t }), 3)
    return
  }
  editor.transaction({ label: bike.localize('Show #{tag}', { tag: t }), animate: { spring: 'navigation' } }, () => {
    editor.focus = editor.outline.root
    editor.filter = {
      path: tagFilterPath(t),
      label: `#${t}`,
      emptyMessage: bike.localize('No rows are tagged #{tag}', { tag: t }),
    }
  })
  setActive(t)
}

function clearTag(editor: OutlineEditor) {
  if (filteredTag(editor)) {
    editor.transaction({ label: bike.localize('Clear Tag Filter'), animate: { spring: 'navigation' } }, () => {
      editor.filter = undefined
    })
  }
  setActive(undefined)
}

function toggleTag(editor: OutlineEditor, tag: string) {
  if (normalizeTag(tag) === filteredTag(editor)) clearTag(editor)
  else showTag(editor, tag)
}

/** The tag this editor is filtered to, when the filter is one this extension set. */
function filteredTag(editor: OutlineEditor | undefined): string | undefined {
  const filter = editor?.filter
  const label = filter?.label
  if (!filter || !label || !label.startsWith('#')) return undefined
  const tag = label.slice(1)
  return filter.path === tagFilterPath(tag) ? tag : undefined
}

function setActive(tag: string | undefined) {
  if (tag === activeTag) return
  activeTag = tag
  safely('badge', registerBadge)
  refreshPanels()
}

// Bike has no filter observer; a light poll notices when the filter is
// cleared or changed by other means (the filter field, Escape, navigation).
function watchFilter() {
  setInterval(() => setActive(filteredTag(bike.frontmostOutlineEditor)), 750)
  bike.observeFrontmostOutlineEditor((editor) => setActive(filteredTag(editor)))
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
  const rows = rowsWithTag(editor.outline, from)
  editor.outline.transaction({ label: bike.localize('Rename Tag') }, () => {
    for (const row of rows) row.setAttribute(ATTR, renamedTag(row.getAttribute(ATTR), from, to))
  })
  editor.showStatusMessage(bike.localize('Renamed #{from} to #{to} on {rows}', { from, to, rows: rowsLabel(rows.length) }), 3)
  if (activeTag === from) showTag(editor, to)
  else refreshPanels()
}

// MARK: - Convert #tags

type ConversionRow = { row: Row; hits: ReturnType<typeof findHashTags> }

function isPlainTextAt(row: Row, index: number): boolean {
  const text = row.text
  return !text.attributeAt('code', index, 'downstream') && !text.attributeAt('a', index, 'downstream')
}

function planConversion(outline: Outline): ConversionRow[] {
  const plan: ConversionRow[] = []
  for (const row of outline.root.descendants) {
    if (row.type === 'code') continue
    const string = row.text.string
    if (string.indexOf('#') < 0) continue
    // Skip #words inside inline code or links.
    const hits = findHashTags(string).filter((hit) => isPlainTextAt(row, hit.start))
    if (hits.length > 0) plan.push({ row, hits })
  }
  return plan
}

function countHashTagRows(outline: Outline): number {
  let count = 0
  for (const row of outline.root.descendants) {
    if (row.type === 'code') continue
    const string = row.text.string
    if (string.indexOf('#') >= 0 && findHashTags(string).length > 0) count++
  }
  return count
}

async function convertCommand({ editor }: CommandContext): Promise<boolean> {
  if (!editor) return false
  const plan = planConversion(editor.outline)
  if (plan.length === 0) {
    await bike.showAlert(
      {
        title: bike.localize('No #tags to Convert'),
        message: bike.localize('No row text in this outline has #tags.'),
        buttons: [bike.localize('OK')],
      },
      bike.frontmostWindow
    )
    return true
  }
  const tagCount = plan.reduce((n, p) => n + p.hits.length, 0)
  const examples = plan
    .slice(0, 3)
    .map(({ row, hits }) => {
      const before = row.text.string
      const after = applyRemoval(before, removalRanges(before, hits))
      return `${clip(before)}\n→ ${clip(after) || '(empty)'}   tag: ${hits.map((h) => h.name).join(', ')}`
    })
    .join('\n\n')
  const result = await bike.showAlert(
    {
      title: bike.localize('Convert #tags to Tag Attributes'),
      message:
        bike.localize(
          '{tags} on {rows} move into each row’s tag attribute, and the #words come out of the row text. Tags are lowercased, so #Reading and #reading merge. You can undo this.',
          {
            tags: bike.localize('{count, plural, one {# tag} other {# tags}}', { count: tagCount }),
            rows: rowsLabel(plan.length),
          }
        ) + `\n\n${examples}`,
      buttons: [bike.localize('Convert {rows}', { rows: rowsLabel(plan.length) }), bike.localize('Cancel')],
    },
    bike.frontmostWindow
  )
  if (result.buttonIndex !== 0) return true

  editor.outline.transaction({ label: bike.localize('Convert #tags') }, () => {
    for (const { row, hits } of plan) {
      const text = row.text
      for (const range of removalRanges(text.string, hits)) text.delete(range)
      row.text = text
      row.setAttribute(ATTR, withTags(row.getAttribute(ATTR), hits.map((h) => h.name)))
    }
  })
  editor.showStatusMessage(bike.localize('Converted {rows}', { rows: rowsLabel(plan.length) }), 4)
  refreshPanels()
  return true
}

function clip(s: string): string {
  return s.length > 60 ? `${s.slice(0, 59)}…` : s
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
          if (tag) showTag(editor, tag)
        })
        return true
      },
      'tags:clear-tag-filter': ({ editor }) => {
        if (!editor || !filteredTag(editor)) return false
        clearTag(editor)
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
  outline?: Outline
  watch?: Disposable
}

const panels = new Set<PanelEntry>()

function registerInspector() {
  bike.observeWindows(async (window) => {
    const handle = await window.inspector.addItem<TagsProtocol>({
      id: 'tags',
      label: bike.localize('Tags'),
      script: 'TagsPanel.js',
    })
    const entry: PanelEntry = { window, handle }
    panels.add(entry)

    handle.onmessage = (message) => {
      const editor = window.currentOutlineEditor
      switch (message.type) {
        case 'ready':
          push(entry)
          break
        case 'toggle':
          if (editor) toggleTag(editor, message.tag)
          break
        case 'clear':
          if (editor) clearTag(editor)
          break
        case 'rename':
          if (editor) renameTagFlow(editor, message.tag)
          break
        case 'add':
          if (editor) {
            const rows = editor.selection?.rows ?? []
            if (rows.length === 0) editor.showStatusMessage(bike.localize('Select a row to tag'), 2)
            else addTagToRows(editor, rows)
          }
          break
        case 'convert':
          if (editor) convertCommand({ editor })
          break
      }
    }

    watchOutline(entry)
    window.observeCurrentOutlineEditor(() => watchOutline(entry))
    window.onClose(() => {
      entry.watch?.dispose()
      panels.delete(entry)
    })
  })
}

/** Re-pushes the panel shortly after its outline stops changing. */
function watchOutline(entry: PanelEntry) {
  const outline = entry.window.currentOutlineEditor?.outline
  if (outline && outline === entry.outline && entry.watch) return
  entry.watch?.dispose()
  entry.watch = undefined
  entry.outline = outline
  if (outline) {
    let timer: number | undefined
    entry.watch = outline.observeChanges((change) => {
      if (change.type !== 'endTransaction' && change.type !== 'reload') return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        push(entry)
      }, 500)
    })
  }
  push(entry)
}

function push(entry: PanelEntry) {
  const editor = entry.window.currentOutlineEditor
  const state: PanelState = editor
    ? {
        hasOutline: true,
        tags: tagCounts(editor.outline),
        active: filteredTag(editor),
        hashTagRows: countHashTagRows(editor.outline),
      }
    : { hasOutline: false, tags: [], hashTagRows: 0 }
  try {
    entry.handle.postMessage({ type: 'state', state })
  } catch (error) {
    console.error('Tags: panel update failed', error)
  }
}

function refreshPanels() {
  for (const entry of panels) push(entry)
}

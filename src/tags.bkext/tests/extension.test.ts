// Runs inside Bike with `npx bike-ext test tags`. These check the parts
// that depend on Bike itself: the filter query and the reconcile rule.

import { Row } from 'bike/app'
import { combinedFilterPath, findHashTags, removalRanges, tagFilterPath } from '../app/tag-core'
import { TagIndex } from '../app/tag-index'

/** Edits a copy of the row's text, then assigns it; editing live text in place can crash Bike. */
function appendText(row: Row, more: string) {
  const live = row.text
  const text = live.substring([0, live.count])
  text.append(more)
  row.text = text
}

async function eventually(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > timeoutMs) assert(false, 'condition not met within ' + timeoutMs + 'ms')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function rows(path: string): Row[] {
  const outline = bike.testOutline()
  const result = outline.query(path)
  return result.type === 'elements' ? (result.value as Row[]) : []
}

describe('tags', () => {
  it('filter query matches whole tags only', () => {
    const outline = bike.testOutline()
    outline.transaction({ label: 'setup' }, () => {
      const made = outline.insertRows(['a', 'b', 'c', 'd', 'e'], outline.root)
      made[0].setAttribute('tag', 'reading')
      made[1].setAttribute('tag', 'idea, reading')
      made[2].setAttribute('tag', 'idea, reading, school')
      made[3].setAttribute('tag', 'reading-list')
      made[4].setAttribute('tag', 'read')
    })
    const hit = rows(tagFilterPath('reading')).map((row) => row.text.string)
    assert.equal(hit.join('|'), 'a|b|c')
  })

  it('hand-typed values settle to the canonical list', () => {
    const outline = bike.testOutline()
    let row: Row | undefined
    outline.transaction({ label: 'setup' }, () => {
      row = outline.insertRows(['x'], outline.root)[0]
    })
    outline.transaction({ label: 'type' }, () => {
      row!.setAttribute('tag', 'Reading,idea , reading')
    })
    assert.equal(row!.getAttribute('tag'), 'reading, idea')
  })

  it('combined filter needs every tag, and can hide done rows', () => {
    const outline = bike.testOutline()
    outline.transaction({ label: 'setup' }, () => {
      const made = outline.insertRows(['a', 'b', 'c', 'd'], outline.root)
      made[0].setAttribute('tag', 'assignment, history')
      made[1].setAttribute('tag', 'assignment')
      made[2].setAttribute('tag', 'history, assignment, reading')
      made[2].setAttribute('status', 'done')
      made[3].setAttribute('tag', 'history')
    })
    const both = rows(combinedFilterPath(['assignment', 'history'], false)).map((row) => row.text.string)
    assert.equal(both.join('|'), 'a|c')
    const open = rows(combinedFilterPath(['assignment', 'history'], true)).map((row) => row.text.string)
    assert.equal(open.join('|'), 'a')
  })

  it('lifts #tags out of row text by editing a copy', () => {
    const outline = bike.testOutline()
    let row: Row | undefined
    outline.transaction({ label: 'setup' }, () => {
      row = outline.insertRows(['Call the library #waiting'], outline.root)[0]
    })
    outline.transaction({ label: 'convert' }, () => {
      const live = row!.text
      const text = live.substring([0, live.count])
      for (const range of removalRanges(text.string, findHashTags(text.string))) text.delete(range)
      row!.text = text
    })
    assert.equal(row!.text.string, 'Call the library')
  })

  it('the index follows tag, status and text edits', async () => {
    const outline = bike.testOutline()
    let area: Row | undefined
    let a: Row | undefined
    let note: Row | undefined
    outline.transaction({ label: 'setup' }, () => {
      area = outline.insertRows(['School'], outline.root)[0]
      ;[a, note] = outline.insertRows(['Essay', 'Plain note'], area)
      a.setAttribute('tag', 'assignment, history')
    })
    const index = new TagIndex(outline, () => {})
    let heard = 0
    index.subscribe(() => heard++)
    try {
      const first = index.tags()
      assert.equal(first.rows.length, 1)
      assert.equal(first.rows[0].area, area!.id)
      assert.equal(first.areas[0].name, 'School')
      assert.equal(index.hashTagRowCount(), 0)

      // Typing in an untagged row leaves tag data alone and wakes no one.
      outline.transaction({ label: 'type' }, () => {
        appendText(note!, ' more')
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      assert(index.tags() === first, 'typing kept the snapshot')
      assert.equal(heard, 0)

      // Typing a #tag shows in the notice count.
      outline.transaction({ label: 'type' }, () => {
        appendText(note!, ' #later')
      })
      await eventually(() => index.hashTagRowCount() === 1)

      // A status change on a tagged row rebuilds.
      outline.transaction({ label: 'done' }, () => {
        a!.setAttribute('status', 'done')
      })
      await eventually(() => index.tags().rows[0]?.closed === true)
      assert(heard > 0, 'listeners heard the change')

      // Removing the row drops it everywhere.
      outline.transaction({ label: 'remove' }, () => {
        outline.removeRows([note!])
      })
      await eventually(() => index.hashTagRowCount() === 0)
    } finally {
      index.dispose()
    }
  })
})

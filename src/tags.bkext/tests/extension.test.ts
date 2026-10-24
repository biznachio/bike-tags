// Runs inside Bike with `npx bike-ext test tags`. These check the parts
// that depend on Bike itself: the filter query and the reconcile rule.

import { Row } from 'bike/app'
import { combinedFilterPath, findHashTags, removalRanges, tagFilterPath } from '../app/tag-core'

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
})

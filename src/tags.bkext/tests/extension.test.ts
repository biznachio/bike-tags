// Runs inside Bike with `npx bike-ext test tags`. These check the parts
// that depend on Bike itself: the filter query and the reconcile rule.

import { Row } from 'bike/app'
import { tagFilterPath } from '../app/tag-core'

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
})

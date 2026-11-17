import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { createHighlightMarker } from './highlightMarker'

describe('createHighlightMarker', () => {
  it('is hidden until it is given a position', () => {
    const marker = createHighlightMarker(1)
    expect(marker.object.visible).toBe(false)
  })

  it('moves to the position it is given and hides again on null', () => {
    const marker = createHighlightMarker(1)
    marker.update(new Vector3(1, 2, 3))
    expect(marker.object.visible).toBe(true)
    expect(marker.object.position.toArray()).toEqual([1, 2, 3])
    marker.update(null)
    expect(marker.object.visible).toBe(false)
  })

  it('draws after the selection marker', () => {
    expect(createHighlightMarker(1).object.renderOrder).toBeGreaterThan(3)
  })
})

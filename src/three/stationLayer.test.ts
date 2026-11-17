import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_KM } from '../orbital/constants'
import { createStationLayer, type StationPositionSource } from './stationLayer'

const KM = 1 / EARTH_RADIUS_KM
const ORBIT = 1 + 400 * KM

/** A source backed by a map of catalog index -> scene position; missing means hidden. */
function sourceOf(points: Record<number, [number, number, number]>): StationPositionSource {
  return {
    getScenePosition(index, target) {
      const point = points[index]
      if (point === undefined) return false
      target.set(...point)
      return true
    },
  }
}

function glyphPositions(layer: ReturnType<typeof createStationLayer>): Vector3[] {
  const attribute = layer.object.geometry.getAttribute('position')
  const { count } = layer.object.geometry.drawRange
  return Array.from({ length: count }, (_, i) => new Vector3().fromBufferAttribute(attribute, i))
}

describe('createStationLayer', () => {
  it('draws nothing before the first update', () => {
    const layer = createStationLayer([3, 7], 1)
    expect(layer.glyphCount()).toBe(0)
    expect(layer.object.geometry.drawRange.count).toBe(0)
  })

  it('draws one glyph for modules docked together and one for each separate station', () => {
    const layer = createStationLayer([3, 7, 9, 12], 1)
    layer.update(
      sourceOf({
        3: [ORBIT, 0, 0],
        // 100 m and 5 km from the first: the same station.
        7: [ORBIT, 0.1 * KM, 0],
        9: [ORBIT, 0, 5 * KM],
        // The other side of the Earth.
        12: [-ORBIT, 0, 0],
      }),
    )
    expect(layer.glyphCount()).toBe(2)
    const [first, second] = glyphPositions(layer)
    expect(first!.x).toBeCloseTo(ORBIT, 6)
    expect(second!.x).toBeCloseTo(-ORBIT, 6)
  })

  it('names the first listed member of each cluster as its representative', () => {
    const layer = createStationLayer([3, 7, 9, 12], 1)
    layer.update(
      sourceOf({ 3: [ORBIT, 0, 0], 7: [ORBIT, 0.1 * KM, 0], 9: [ORBIT, 0, 5 * KM], 12: [-ORBIT, 0, 0] }),
    )
    expect([3, 7, 9, 12].map((index) => layer.representativeOf(index))).toEqual([3, 3, 3, 12])
  })

  it('leaves satellites that are not stations alone', () => {
    const layer = createStationLayer([3], 1)
    layer.update(sourceOf({ 3: [ORBIT, 0, 0] }))
    expect(layer.representativeOf(42)).toBe(42)
  })

  it('gives a vehicle its own glyph once it has drifted away', () => {
    const layer = createStationLayer([3, 7], 1)
    layer.update(sourceOf({ 3: [ORBIT, 0, 0], 7: [ORBIT, 49 * KM, 0] }))
    expect(layer.glyphCount()).toBe(1)
    layer.update(sourceOf({ 3: [ORBIT, 0, 0], 7: [ORBIT, 51 * KM, 0] }))
    expect(layer.glyphCount()).toBe(2)
    expect(layer.representativeOf(7)).toBe(7)
  })

  it('skips hidden members and passes the glyph to the next one shown', () => {
    const layer = createStationLayer([3, 7], 1)
    // Member 3 is hidden (decayed, or filtered out).
    layer.update(sourceOf({ 7: [ORBIT, 0, 0] }))
    expect(layer.glyphCount()).toBe(1)
    expect(layer.representativeOf(7)).toBe(7)
    // A hidden member stands for itself.
    expect(layer.representativeOf(3)).toBe(3)

    // Everything hidden: no glyphs at all.
    layer.update(sourceOf({}))
    expect(layer.glyphCount()).toBe(0)
    expect(layer.object.geometry.drawRange.count).toBe(0)
  })

  it('scales the glyph with the pixel ratio', () => {
    const layer = createStationLayer([3], 1)
    const size = () => (layer.object.material as unknown as { uniforms: { uSize: { value: number } } }).uniforms.uSize.value
    const base = size()
    layer.setPixelRatio(2)
    expect(size()).toBe(base * 2)
  })
})

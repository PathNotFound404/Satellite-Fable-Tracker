import { SphereGeometry } from 'three'
import { describe, expect, it } from 'vitest'
import { EARTH_RADIUS_KM } from '../orbital/constants'
import { geodeticToScene, kmToScene, sceneToKm, writeEcfKmToScene } from './units'

describe('km <-> scene units', () => {
  it('maps one Earth radius to one scene unit', () => {
    expect(kmToScene(EARTH_RADIUS_KM)).toBeCloseTo(1, 12)
    expect(sceneToKm(1)).toBe(EARTH_RADIUS_KM)
  })

  it('round-trips', () => {
    expect(sceneToKm(kmToScene(42164))).toBeCloseTo(42164, 6)
  })
})

describe('ECF -> scene axes', () => {
  const out = [0, 0, 0]

  it('puts the North Pole on +y', () => {
    writeEcfKmToScene(0, 0, EARTH_RADIUS_KM, out)
    expect(out).toEqual([0, 1, 0])
  })

  it('puts (lat 0, lon 0) on +x', () => {
    writeEcfKmToScene(EARTH_RADIUS_KM, 0, 0, out)
    expect(out).toEqual([1, 0, 0])
  })

  it('puts (lat 0, lon 90E) on -z', () => {
    writeEcfKmToScene(0, EARTH_RADIUS_KM, 0, out)
    expect(out).toEqual([0, 0, -1])
  })

  it('keeps the frame right-handed (x cross y = z still holds after the remap)', () => {
    const x = [0, 0, 0]
    const y = [0, 0, 0]
    const z = [0, 0, 0]
    writeEcfKmToScene(EARTH_RADIUS_KM, 0, 0, x)
    writeEcfKmToScene(0, EARTH_RADIUS_KM, 0, y)
    writeEcfKmToScene(0, 0, EARTH_RADIUS_KM, z)
    const cross = [
      x[1]! * y[2]! - x[2]! * y[1]!,
      x[2]! * y[0]! - x[0]! * y[2]!,
      x[0]! * y[1]! - x[1]! * y[0]!,
    ]
    expect(cross[0]).toBeCloseTo(z[0]!, 12)
    expect(cross[1]).toBeCloseTo(z[1]!, 12)
    expect(cross[2]).toBeCloseTo(z[2]!, 12)
  })

  it('writes at the given offset without touching neighbours', () => {
    const buf = new Float32Array(9).fill(7)
    writeEcfKmToScene(0, 0, EARTH_RADIUS_KM, buf, 3)
    expect(Array.from(buf)).toEqual([7, 7, 7, 0, 1, 0, 7, 7, 7])
  })
})

describe('geodeticToScene', () => {
  it('scales with altitude', () => {
    const out = [0, 0, 0]
    geodeticToScene(0, 0, EARTH_RADIUS_KM, out)
    expect(out[0]).toBeCloseTo(2, 12)
  })

  /**
   * Guards the texture alignment: the scene position we compute for a lat/lon must be
   * the same point where three.js's SphereGeometry samples that lat/lon from an
   * equirectangular texture (u = lon/360 + 0.5, v = lat/180 + 0.5).
   */
  it('agrees with where SphereGeometry maps the texture', () => {
    const geometry = new SphereGeometry(1, 36, 18)
    const position = geometry.getAttribute('position')
    const uv = geometry.getAttribute('uv')
    const out = [0, 0, 0]
    let checked = 0
    for (let i = 0; i < position.count; i++) {
      const latitudeDeg = (uv.getY(i) - 0.5) * 180
      // Poles collapse every longitude to one point; skip them.
      if (Math.abs(latitudeDeg) > 89) continue
      const longitudeDeg = (uv.getX(i) - 0.5) * 360
      geodeticToScene(latitudeDeg, longitudeDeg, 0, out)
      expect(out[0]).toBeCloseTo(position.getX(i), 5)
      expect(out[1]).toBeCloseTo(position.getY(i), 5)
      expect(out[2]).toBeCloseTo(position.getZ(i), 5)
      checked++
    }
    expect(checked).toBeGreaterThan(500)
  })
})

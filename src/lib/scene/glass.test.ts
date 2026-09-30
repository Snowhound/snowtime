import { describe, expect, test } from 'bun:test'
import { blur } from './glass'

function image(width: number, height: number, value: (x: number, y: number) => number) {
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set([value(x, y), value(x, y), value(x, y), 255], (y * width + x) * 4)
    }
  }
  return pixels
}

describe('blur', () => {
  test('keeps a flat image and its alpha as they are', () => {
    const pixels = image(8, 6, () => 120)
    blur(pixels, 8, 6, 2)
    expect([...new Set(pixels)].sort()).toEqual([120, 255])
  })

  test('spreads a point evenly and keeps its light', () => {
    const pixels = image(21, 21, (x, y) => (x === 10 && y === 10 ? 255 : 0))
    blur(pixels, 21, 21, 2)
    function at(x: number, y: number) {
      return pixels[(y * 21 + x) * 4]
    }
    expect(at(10, 10)).toBeLessThan(20)
    expect(at(8, 10)).toBe(at(12, 10))
    expect(at(10, 8)).toBe(at(8, 10))
    let total = 0
    for (let i = 0; i < pixels.length; i += 4) total += pixels[i]
    expect(total).toBeGreaterThan(230)
    expect(total).toBeLessThan(280)
  })
})

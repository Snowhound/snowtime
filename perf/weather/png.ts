// Reads the 8-bit, non-interlaced RGB and RGBA PNGs that Chrome's screenshots are, and compares
// two of them pixel by pixel, for the golden frames.
import { unzlibSync } from 'fflate'

type Image = { width: number; height: number; channels: number; pixels: Uint8Array }

function paeth(a: number, b: number, c: number) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

function decodePng(file: Uint8Array): Image {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  let width = 0
  let height = 0
  let channels = 0
  const chunks: Uint8Array[] = []
  for (let at = 8; at < file.length;) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8))
    const data = file.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = view.getUint32(at + 8)
      height = view.getUint32(at + 12)
      const [depth, color, , , interlace] = data.subarray(8)
      if (depth !== 8 || interlace || (color !== 2 && color !== 6)) {
        throw new Error(`Unsupported PNG: depth ${depth}, color type ${color}`)
      }
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') chunks.push(data)
    at += 12 + length
  }
  const packed = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    packed.set(chunk, offset)
    offset += chunk.length
  }
  const raw = unzlibSync(packed)

  // Each row starts with its filter type; the filters predict a byte from the one to its left
  // (a), above (b), and above left (c).
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1)
    const row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels] : 0
      const b = y ? pixels[row - stride + x] : 0
      const c = y && x >= channels ? pixels[row - stride + x - channels] : 0
      const predicted =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? (a + b) >> 1
              : filter === 4
                ? paeth(a, b, c)
                : 0
      pixels[row + x] = line[x] + predicted
    }
  }
  return { width, height, channels, pixels }
}

// The pixels whose largest channel difference is above `threshold`, and the largest difference.
export function comparePng(a: Uint8Array, b: Uint8Array, threshold: number) {
  const first = decodePng(a)
  const second = decodePng(b)
  if (
    first.width !== second.width ||
    first.height !== second.height ||
    first.channels !== second.channels
  ) {
    return { size: false, differing: first.width * first.height, largest: 255 }
  }
  let differing = 0
  let largest = 0
  const { channels, pixels } = first
  for (let i = 0; i < pixels.length; i += channels) {
    let pixel = 0
    for (let k = 0; k < channels; k++) {
      pixel = Math.max(pixel, Math.abs(pixels[i + k] - second.pixels[i + k]))
    }
    if (pixel > threshold) differing++
    largest = Math.max(largest, pixel)
  }
  return { size: true, differing, largest }
}

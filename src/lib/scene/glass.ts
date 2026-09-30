// The glass surfaces' copy of the scene's photo (src/styles.css, "Glass"): the photo blurred once,
// as `backdrop-filter: blur(24px)` would blur it on this screen, so the surfaces don't blur the
// scene again on every weather frame.

// The copy's width. A blurred image scales up without visible steps while its pixels are no
// farther apart than the blur's radius, which holds on screens up to 5760 CSS px across.
const WIDTH = 240
// The glass's blur radius in CSS px, the standard deviation of `blur(24px)`.
const RADIUS = 24

// A separable Gaussian blur of RGBA pixels in place, clamped at the edges. Alpha stays as it is.
export function blur(pixels: Uint8ClampedArray, width: number, height: number, sigma: number) {
  const reach = Math.ceil(sigma * 3)
  const kernel = Array.from({ length: 2 * reach + 1 }, (_, i) =>
    Math.exp(-((i - reach) ** 2) / (2 * sigma * sigma)),
  )
  const sum = kernel.reduce((a, b) => a + b)
  const weights = kernel.map((k) => k / sum)
  const rows = new Float32Array(pixels.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let total = 0
        for (let k = -reach; k <= reach; k++) {
          const sx = Math.min(width - 1, Math.max(0, x + k))
          total += weights[k + reach] * pixels[(y * width + sx) * 4 + c]
        }
        rows[(y * width + x) * 4 + c] = total
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let total = 0
        for (let k = -reach; k <= reach; k++) {
          const sy = Math.min(height - 1, Math.max(0, y + k))
          total += weights[k + reach] * rows[(sy * width + x) * 4 + c]
        }
        pixels[(y * width + x) * 4 + c] = total
      }
    }
  }
}

// The photo at `url` blurred for the glass on a screen of this size, where it covers the screen as
// .scene-photo-image does, as a data URL, which the content security policy allows for images.
// Null if the photo doesn't decode.
export async function glassPhoto(url: string, screen: { width: number; height: number }) {
  const image = new Image()
  image.src = url
  try {
    await image.decode()
  } catch {
    return null
  }
  const aspect = image.naturalWidth / image.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = Math.round(WIDTH / aspect)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const shown = Math.max(screen.width, screen.height * aspect)
  const data = context.getImageData(0, 0, canvas.width, canvas.height)
  blur(data.data, canvas.width, canvas.height, (RADIUS * WIDTH) / shown)
  context.putImageData(data, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.9)
}

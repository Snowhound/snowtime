// The glass surfaces over the weather on each page, measured on the app at 1440 × 900 (the company
// admin's timer, reports for this month, and the sign-in page). `header` is the sticky app header,
// which blurs less (.scene-header in src/styles.css); the rest are .surface cards.
type Rect = { x: number; y: number; w: number; h: number; radius: number; header?: true }

const HEADER: Rect = { x: 0, y: 0, w: 1440, h: 57, radius: 0, header: true }

export const LAYOUTS = {
  none: [],
  'sign-in': [
    { x: 528, y: 66, w: 384, h: 728, radius: 10 },
    { x: 615, y: 810, w: 209, h: 24, radius: 8 },
  ],
  timer: [
    HEADER,
    { x: 144, y: 133, w: 840, h: 68, radius: 14 },
    { x: 144, y: 225, w: 840, h: 367, radius: 10 },
    { x: 144, y: 608, w: 840, h: 237, radius: 10 },
    { x: 144, y: 861, w: 840, h: 367, radius: 10 },
    { x: 1008, y: 133, w: 288, h: 286, radius: 10 },
  ],
  reports: [HEADER, { x: 32, y: 277, w: 1376, h: 699, radius: 10 }],
} satisfies Record<string, Rect[]>

export type Layout = keyof typeof LAYOUTS

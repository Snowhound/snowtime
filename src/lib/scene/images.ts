// The scene's image ids and the collections that hold them (docs/architecture.md, "Seasonal
// scene"). An id and its collection name the image's files,
// /backgrounds/<collection>/<id>-<theme>-01-<width>.avif. The settings schemas and the database
// schema import these, so this file imports nothing.

export const SEASONS = ['winter', 'spring', 'summer', 'autumn'] as const
export type Season = (typeof SEASONS)[number]

export const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const
type Month = (typeof MONTHS)[number]

export type ImageId = Season | `coast-${Month}` | `land-${Month}`

// The first is the default. Mountain valley follows the season; the others hold one image per
// month, in month order.
export const COLLECTION_IDS = ['mountains', 'countryside', 'coast'] as const
export type CollectionId = (typeof COLLECTION_IDS)[number]

export const COLLECTION_IMAGES: Record<CollectionId, readonly ImageId[]> = {
  mountains: SEASONS,
  countryside: MONTHS.map((month) => `land-${month}` as const),
  coast: MONTHS.map((month) => `coast-${month}` as const),
}

export const IMAGE_IDS = Object.values(COLLECTION_IMAGES).flat() as [ImageId, ...ImageId[]]

export function inCollection(collection: CollectionId, id: ImageId) {
  return COLLECTION_IMAGES[collection].includes(id)
}

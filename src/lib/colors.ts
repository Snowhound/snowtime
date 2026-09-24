// The eight project colors. project.color stores the light hex; each maps to a --series-N
// variable in src/styles.css, which switches to the slot's dark step in dark mode.
export const PROJECT_COLORS = [
  '#3b82b8', // blue, the brand's slate blue
  '#d9703f', // terracotta
  '#1f9e8a', // teal
  '#d59a1c', // ochre
  '#c9759f', // rose
  '#4f8f3a', // moss
  '#5a4fa8', // indigo
  '#c9514f', // brick
] as const

// The CSS color for a stored project color. A color outside the palette (set before the
// palette existed, or by a script) shows as stored, the same in both themes.
export function projectColor(hex: string | null | undefined): string {
  if (!hex) return 'var(--muted-foreground)'
  const i = PROJECT_COLORS.indexOf(hex.toLowerCase() as (typeof PROJECT_COLORS)[number])
  return i < 0 ? hex : `var(--series-${i + 1})`
}

// A new project gets the least used color, earliest in the palette on a tie.
export function leastUsedColor(used: readonly (string | null)[]): string {
  const counts = PROJECT_COLORS.map((c) => used.filter((u) => u?.toLowerCase() === c).length)
  return PROJECT_COLORS[counts.indexOf(Math.min(...counts))]
}

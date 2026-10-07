export const DEFAULT_COPY_PATTERN = 'H:MM:SS'
export const MAX_COPY_PATTERN = 40

export function validDurationPattern(pattern: string): boolean {
  return (
    pattern.length > 0 &&
    pattern.length <= MAX_COPY_PATTERN &&
    /[HMS]/.test(pattern.replace(/\\[\s\S]/g, ''))
  )
}

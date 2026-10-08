// The copyDurationPattern setting: the text a copied duration becomes (docs/architecture/timer.md,
// "Copying durations"). Runs of H, M, or S are hours, minutes, and seconds, the run's length
// their minimum digits; a backslash keeps the next character; anything else is copied as typed.

type Field = 'H' | 'M' | 'S'

// A piece of the pattern as typed, so the settings field can color it: a field, a character
// kept by a backslash (with the backslash), or other text.
export type PatternToken =
  | { kind: 'field'; source: string; field: Field }
  | { kind: 'escape'; source: string; text: string }
  | { kind: 'text'; source: string }

// Typing in the settings field tokenizes every draft, so the cache starts over past this size.
const CACHE_SIZE = 100
const tokenized = new Map<string, PatternToken[]>()

export function tokenizePattern(pattern: string): PatternToken[] {
  let tokens = tokenized.get(pattern)
  if (tokens) return tokens
  tokens = []
  let i = 0
  while (i < pattern.length) {
    const char = pattern[i]
    if (char === '\\' && i + 1 < pattern.length) {
      tokens.push({ kind: 'escape', source: pattern.slice(i, i + 2), text: pattern[i + 1] })
      i += 2
    } else if (char === 'H' || char === 'M' || char === 'S') {
      let end = i + 1
      while (pattern[end] === char) end++
      tokens.push({ kind: 'field', source: pattern.slice(i, end), field: char })
      i = end
    } else {
      let end = i + 1
      while (end < pattern.length && !'HMS\\'.includes(pattern[end])) end++
      tokens.push({ kind: 'text', source: pattern.slice(i, end) })
      i = end
    }
  }
  if (tokenized.size >= CACHE_SIZE) tokenized.clear()
  tokenized.set(pattern, tokens)
  return tokens
}

// Fields inside a word, such as the H of "Hours", which were likely meant as text: after a
// letter, or before two. One letter after is a unit, as in `Hh Mm Ss`. The settings field
// warns about them, but they still save.
export function fieldsInWords(pattern: string): string[] {
  const tokens = tokenizePattern(pattern)
  return tokens
    .filter((token, i) => {
      if (token.kind !== 'field') return false
      const before = tokens[i - 1]?.source.at(-1) ?? ''
      const after = tokens[i + 1]?.source ?? ''
      return /\p{L}/u.test(before) || /^\p{L}{2}/u.test(after)
    })
    .map((token) => token.source)
}

// The largest field in the pattern holds the whole duration, so hours don't wrap at 24 and
// `M:SS` gives 125:09 for 2:05:09. Round to the smallest field, except seconds,
// which are cut off as the entry rows show them.
export function formatDurationPattern(ms: number, pattern: string): string {
  const tokens = tokenizePattern(pattern)
  function has(field: Field) {
    return tokens.some((token) => token.kind === 'field' && token.field === field)
  }
  const unit = has('M') ? 60 : 3600
  let rest = Math.max(0, has('S') ? Math.floor(ms / 1000) : Math.round(ms / (unit * 1000)) * unit)
  const values: Record<Field, number> = { H: 0, M: 0, S: 0 }
  if (has('H')) {
    values.H = Math.floor(rest / 3600)
    rest %= 3600
  }
  if (has('M')) {
    values.M = Math.floor(rest / 60)
    rest %= 60
  }
  values.S = rest
  return tokens
    .map((token) => {
      if (token.kind === 'field') {
        return String(values[token.field]).padStart(token.source.length, '0')
      }
      return token.kind === 'escape' ? token.text : token.source
    })
    .join('')
}

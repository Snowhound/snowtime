import { describe, expect, test } from 'bun:test'
import { introLines, seasonSets } from './seasons'

const DAY = 86_400_000

function at(iso: string) {
  return Date.parse(iso)
}

describe('introLines', () => {
  test('keeps one set through a UTC day and moves to the next the day after', () => {
    const day = introLines('autumn', at('2026-10-06T00:00:00Z'))
    expect(introLines('autumn', at('2026-10-06T23:59:59Z'))).toEqual(day)
    expect(introLines('autumn', at('2026-10-07T00:00:00Z'))).not.toEqual(day)
  })

  test("shows only the season's sets, each in turn", () => {
    const shown = new Set(
      Array.from({ length: 30 }, (_, d) =>
        introLines('autumn', at('2026-09-01T12:00:00Z') + d * DAY).join('\n'),
      ),
    )
    expect(shown).toEqual(new Set(seasonSets('autumn').map((set) => set.join('\n'))))
  })
})

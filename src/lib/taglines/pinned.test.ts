// Pins the tagline shown on each day of a leap year, in both languages, with the month's
// season, so a change to the catalogue or the pick shows up as a snapshot diff.
import { expect, test } from 'bun:test'
import { addDays } from '~/lib/calendar'
import { seasonByMonth } from '~/lib/scene/scene'
import { taglineLines } from './taglines'

test('shows the same taglines on every day of 2028', () => {
  const shown: string[] = []
  for (let date = '2028-01-01'; date < '2029-01-01'; date = addDays(date, 1)) {
    const now = Date.parse(`${date}T12:00:00Z`)
    const season = seasonByMonth(new Date(now))
    for (const locale of ['en', 'et'] as const) {
      const lines = taglineLines(season, { now, timeZone: 'Europe/Tallinn', locale })
      shown.push(`${date} ${locale} ${lines.join(' | ')}`)
    }
  }
  expect(shown.join('\n')).toMatchSnapshot()
})

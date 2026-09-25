import { describe, expect, test } from 'bun:test'
import { strFromU8, unzipSync } from 'fflate'
import type { Member } from '~/lib/members'
import type { Project } from '~/lib/projects'
import {
  type ReportEntries,
  entriesTable,
  exportFileName,
  hours,
  timesheetTable,
  toCsv,
  toXlsx,
} from './export'
import type { Report } from './queries'
import type { Row } from './rows'

const HOUR = 3_600_000

const report = {
  buckets: ['2026-09-21', '2026-09-22'],
  perBucket: [1.5 * HOUR, 2 * HOUR],
  total: 3.5 * HOUR,
} as Report

const rows: Row[] = [
  { key: 'p1', name: 'Client, "portal"', total: 2.5 * HOUR, perBucket: [0.5 * HOUR, 2 * HOUR] },
  { key: 'p2', name: '=HYPERLINK("x")', total: HOUR, perBucket: [HOUR, 0] },
]

const members = [{ userId: 'u1', name: 'Mari Tamm' }] as Member[]
const projects = [{ id: 'p1', name: 'Õunaaed' }] as Project[]

function entries(list: Partial<ReportEntries['entries'][number]>[]): ReportEntries {
  return {
    timeZone: 'Europe/Tallinn',
    entries: list.map((e) => ({
      entryId: 'e1',
      userId: 'u1',
      projectId: 'p1',
      description: '',
      date: '2026-09-21',
      from: new Date('2026-09-21T06:00:00Z'),
      to: new Date('2026-09-21T07:30:00Z'),
      running: false,
      ms: 1.5 * HOUR,
      ...e,
    })),
  }
}

describe('toCsv', () => {
  test('starts with a BOM, quotes commas and quotes, and escapes formulas', () => {
    const csv = toCsv(timesheetTable(report, rows, 'project'))
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Project,2026-09-21,2026-09-22,Total',
      '"Client, ""portal""",0.5,2,2.5',
      `"'=HYPERLINK(""x"")",1,0,1`,
      'Total,1.5,2,3.5',
      '',
    ])
  })

  test('escapes every formula prefix in text, not in numbers', () => {
    const csv = toCsv({
      header: ['a', 'b', 'c', 'd', 'e'],
      rows: [['+1', '-fix', '@me', '\tx', { ms: HOUR }]],
    })
    expect(csv.split('\r\n')[1]).toBe(`'+1,'-fix,'@me,'\tx,1`)
  })
})

describe('entriesTable', () => {
  test("names the member and project, and gives times in the user's zone", () => {
    const table = entriesTable(
      entries([
        { description: 'Planning' },
        {
          projectId: null,
          from: new Date('2026-09-21T20:00:00Z'),
          to: new Date('2026-09-21T21:00:00Z'),
          ms: HOUR,
        },
        {
          from: new Date('2026-09-21T09:00:00Z'),
          to: new Date('2026-09-21T10:00:00Z'),
          running: true,
        },
      ]),
      { projects, members },
    )
    expect(table.header).toEqual([
      'Date',
      'Member',
      'Project',
      'Description',
      'Start',
      'End',
      'Duration',
    ])
    expect(table.rows).toEqual([
      ['2026-09-21', 'Mari Tamm', 'Õunaaed', 'Planning', '09:00', '10:30', { ms: 1.5 * HOUR }],
      // A piece that ends at midnight ends at 24:00.
      ['2026-09-21', 'Mari Tamm', 'No project', '', '23:00', '24:00', { ms: HOUR }],
      // A running entry has no end.
      ['2026-09-21', 'Mari Tamm', 'Õunaaed', '', '12:00', null, { ms: 1.5 * HOUR }],
    ])
  })
})

test('hours rounds to two decimals', () => {
  expect(hours(20 * 60_000)).toBe(0.33)
  expect(hours(HOUR * 7.5)).toBe(7.5)
})

test('file names name the organization and the range', () => {
  expect(exportFileName('snowhound', '2026-09-01', '2026-09-30', 'csv')).toBe(
    'snowhound-2026-09-01-to-2026-09-30.csv',
  )
  expect(exportFileName('snowhound', '2026-09-01', '2026-09-30', 'entries')).toBe(
    'snowhound-2026-09-01-to-2026-09-30-entries.csv',
  )
  expect(exportFileName('snowhound', '2026-09-01', '2026-09-30', 'xlsx')).toBe(
    'snowhound-2026-09-01-to-2026-09-30.xlsx',
  )
})

test('toXlsx writes a sheet per table, with durations as [h]:mm numbers', async () => {
  const blob = await toXlsx([
    { name: 'Timesheet', table: timesheetTable(report, rows, 'project') },
    { name: 'Entries', table: entriesTable(entries([{}]), { projects, members }) },
  ])
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()))
  const workbook = strFromU8(files['xl/workbook.xml'])
  expect(workbook).toContain('name="Timesheet"')
  expect(workbook).toContain('name="Entries"')
  expect(strFromU8(files['xl/styles.xml'])).toContain('formatCode="[h]:mm"')
  // 1.5 hours is 1.5 / 24 of a day.
  expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain(`<v>${0.5 / 24}</v>`)
  expect(
    Object.values(files)
      .map((f) => strFromU8(f))
      .join(''),
  ).toContain('Õunaaed')
})

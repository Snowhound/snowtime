// Checks that every Lucide icon is imported under its own name with an `Icon` suffix, so
// code reads as `<ClockIcon />`, never a bare `<Clock />` that could be any component:
//
//   import ClockIcon from 'lucide-solid/icons/clock'
//   import BuildingComplexIcon from 'lucide-solid/icons/building-complex'
//
// The name is the icon's file name in PascalCase plus `Icon`. With --fix, the script
// renames each wrong import and every use of it in the file.
//
// Usage: bun scripts/icon-names.ts [--fix]

import { Glob } from 'bun'
import { readFileSync, writeFileSync } from 'node:fs'

const fix = process.argv.includes('--fix')
const importPattern = /^import (\w+) from ['"]lucide-solid\/icons\/([\w-]+)['"]/gm

function expectedName(icon: string) {
  return (
    icon
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('') + 'Icon'
  )
}

let problems = 0
for await (const file of new Glob('src/**/*.{ts,tsx}').scan('.')) {
  let source = readFileSync(file, 'utf8')
  const renames = new Map<string, string>()
  for (const [, name, icon] of source.matchAll(importPattern)) {
    const expected = expectedName(icon)
    if (name !== expected) renames.set(name, expected)
  }
  if (renames.size === 0) continue

  for (const [name, expected] of renames) {
    console.log(`${file}: ${name} -> ${expected}`)
    source = source.replace(new RegExp(`\\b${name}\\b`, 'g'), expected)
  }
  problems += renames.size
  if (fix) writeFileSync(file, source)
}

if (problems > 0 && !fix) {
  console.error(`[icon-names] ${problems} icon import(s) misnamed; run with --fix.`)
  process.exit(1)
}

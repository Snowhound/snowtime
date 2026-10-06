// Compares committed rows after stopping the app and letting replication catch up.
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
const [live, restored, output] = process.argv.slice(2)
if (!live || !restored || !output)
  throw new Error('Usage: verify-restore.ts live.db restored.db output.json')
function fingerprint(path: string) {
  const db = new Database(path, { readonly: true })
  const integrity = db.query('PRAGMA integrity_check').all()
  const tables = db
    .query(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all() as { name: string; sql: string }[]
  const result = tables.map(({ name, sql }) => {
    const quoted = '"' + name.replaceAll('"', '""') + '"'
    const hash = createHash('sha256')
    let count = 0
    const columns = db.query(`PRAGMA table_info(${quoted})`).all() as { name: string; pk: number }[]
    const order = sql.includes('WITHOUT ROWID')
      ? columns
          .filter((c) => c.pk)
          .sort((a, b) => a.pk - b.pk)
          .map((c) => '"' + c.name.replaceAll('"', '""') + '"')
          .join(',')
      : 'rowid'
    for (const row of db.query(`SELECT * FROM ${quoted} ORDER BY ${order}`).iterate()) {
      hash.update(JSON.stringify(row))
      hash.update('\n')
      count++
    }
    return { name, sql, count, sha256: hash.digest('hex') }
  })
  db.close()
  return { integrity, tables: result }
}
const original = fingerprint(live)
const replica = fingerprint(restored)
const equal = JSON.stringify(original) === JSON.stringify(replica)
writeFileSync(output, JSON.stringify({ equal, live: original, restored: replica }, null, 2))
if (!equal || JSON.stringify(original.integrity) !== '[{"integrity_check":"ok"}]')
  throw new Error('Replica restore does not match live committed data')
console.log(
  'Integrity checks pass; schema, row counts, and ordered row hashes match for every table',
)

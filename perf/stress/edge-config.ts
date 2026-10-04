// Derive one edge experiment from Caddy's effective JSON configuration.
import { readFileSync, writeFileSync } from 'node:fs'

const [source, destination, ...variants] = process.argv.slice(2)
if (!source || !destination) {
  throw new Error('Usage: bun perf/stress/edge-config.ts <source.json> <output.json> <variants...>')
}
const config = JSON.parse(readFileSync(source, 'utf8'))
const server = config.apps.http.servers.srv0
const host = Object.keys(server.logs.logger_names)[0]

function removeEncode(value: unknown) {
  if (Array.isArray(value)) {
    value.forEach(removeEncode)
  } else if (value && typeof value === 'object') {
    const node = value as Record<string, unknown>
    if (Array.isArray(node.handle)) {
      node.handle = node.handle.filter((handler) => handler.handler !== 'encode')
    }
    Object.values(node).forEach(removeEncode)
  }
}

for (const variant of variants) {
  switch (variant) {
    case 'single-log':
      server.logs.logger_names[host] = ['bench']
      break
    case 'sampled':
      config.logging.logs.log0.sampling = { interval: 1_000_000_000, first: 10, thereafter: 100 }
      break
    case 'no-log':
      delete server.logs.logger_names[host]
      server.logs.skip_hosts = [host]
      break
    case 'h1':
      server.protocols = ['h1']
      break
    case 'no-encode':
      removeEncode(config)
      break
    default:
      throw new Error(`Unknown edge variant: ${variant}`)
  }
}
writeFileSync(destination, JSON.stringify(config, null, 2))

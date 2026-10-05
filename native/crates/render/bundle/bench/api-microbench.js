// oxlint-disable-next-line typescript/no-floating-promises -- The Rust harness awaits this script's returned promise.
;(async function () {
  // Compare Deno and ICU themselves, even when the production snapshot has wrappers.
  if (typeof denoEncode === 'function') TextEncoder.prototype.encode = denoEncode
  if (typeof nativeFormatToParts === 'function')
    Intl.DateTimeFormat.prototype.formatToParts = nativeFormatToParts
  const ops = Deno.core.ops
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const jsEncoder = new JSTextEncoder()
  const jsDecoder = new JSTextDecoder()
  const rows = []
  function equal(actual, expected, label) {
    const left = ArrayBuffer.isView(actual) ? Array.from(actual) : actual
    const right = ArrayBuffer.isView(expected) ? Array.from(expected) : expected
    if (JSON.stringify(left) !== JSON.stringify(right)) throw Error(label + ' differs')
  }
  async function measure(api, candidate, fn, count, calls, size) {
    for (let i = 0; i < 20; i++) await fn()
    for (let run = 1; run <= 3; run++) {
      const start = ops.op_bench_now()
      for (let i = 0; i < count; i++) await fn()
      rows.push({
        page: benchInputs.page,
        api,
        candidate,
        run,
        count,
        calls_per_page: calls,
        argument_size: size,
        us_per_call: ((ops.op_bench_now() - start) * 1000) / count,
      })
    }
  }
  const encoders = [
    ['Deno', (text) => encoder.encode(text)],
    ['core.encode', (text) => Deno.core.encode(text)],
    ['Rust op', ops.op_encode_rust],
    ['simdutf op', ops.op_encode_simdutf],
    ['JS fallback', (text) => jsEncoder.encode(text)],
  ]
  for (const input of ['', 'ASCII', 'Tere õhtust 😀', '\ud800']) {
    for (const [name, fn] of encoders) equal(fn(input), encoder.encode(input), name)
  }
  for (const [call, frequency] of Object.entries(benchInputs.trace)) {
    const match = /^TextEncoder.encode\(string:(\d+)\)$/.exec(call)
    if (!match) continue
    const length = Number(match[1])
    const text = benchInputs.html.slice(0, length)
    for (const [name, fn] of encoders)
      await measure('TextEncoder.encode', name, () => fn(text), 200, frequency, length)
  }
  const decoders = [
    ['Deno', (bytes) => decoder.decode(bytes)],
    ['core.decode', (bytes) => Deno.core.decode(bytes)],
    ['Rust op', ops.op_decode_rust],
    ['encoding_rs op', ops.op_decode_encoding_rs],
    ['simdutf op', ops.op_decode_simdutf],
    ['JS fallback', (bytes) => jsDecoder.decode(bytes)],
  ]
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array([239, 187, 191, 65]),
    new Uint8Array([255, 65]),
    encoder.encode('Tere õhtust 😀'),
  ]) {
    for (const [name, fn] of decoders) equal(fn(bytes), decoder.decode(bytes), name)
  }
  const bodies = Object.values(benchInputs.answers)
    .filter((answer) => benchInputs.trace['Response(bytes:' + answer.body.length + ',object)'])
    .map((answer) => new Uint8Array(answer.body))
  for (const bytes of bodies) {
    for (const [name, fn] of decoders)
      await measure('TextDecoder.decode', name, () => fn(bytes), 500, 1, bytes.length)
    equal(await new Response(bytes).json(), JSON.parse(decoder.decode(bytes)), 'Response.json')
    await measure(
      'Response.json',
      'Deno Response',
      () => new Response(bytes).json(),
      500,
      1,
      bytes.length,
    )
    await measure(
      'Response.json',
      'direct decode + JSON.parse',
      () => JSON.parse(decoder.decode(bytes)),
      500,
      1,
      bytes.length,
    )
  }
  const absolute = benchInputs.request.url
  const base = new URL(absolute).origin
  for (const [input, origin] of [
    [absolute, ''],
    [new URL(absolute).pathname + new URL(absolute).search, base],
  ]) {
    equal(ops.op_url_ada(input, origin), new URL(input, origin || undefined).href, 'Ada')
    await measure(
      'URL',
      'Deno',
      () => new URL(input, origin || undefined).href,
      3000,
      1,
      input.length,
    )
    await measure('URL', 'Ada thin op', () => ops.op_url_ada(input, origin), 3000, 1, input.length)
  }
  function formEncode(value) {
    return encodeURIComponent(String(value).toWellFormed())
      .replace(/[!'()~]/g, (char) => '%' + char.charCodeAt(0).toString(16).toUpperCase())
      .replace(/%20/g, '+')
  }
  function stringify(fields) {
    return Object.entries(fields)
      .map(([key, value]) => formEncode(key) + '=' + formEncode(value))
      .join('&')
  }
  for (const fields of [
    {},
    { range: 'this-week' },
    { from: '2026-01-01', to: '2026-09-30' },
    { q: 'õ 😀 +~!' },
  ]) {
    equal(stringify(fields), new URLSearchParams(fields).toString(), 'JS params')
    await measure(
      'URLSearchParams(object).toString',
      'Deno',
      () => new URLSearchParams(fields).toString(),
      3000,
      1,
      Object.keys(fields).length,
    )
    await measure(
      'URLSearchParams(object).toString',
      'minimal JS',
      () => stringify(fields),
      3000,
      1,
      Object.keys(fields).length,
    )
  }
  const headers = benchInputs.request.headers
  await measure(
    'Headers',
    'Deno construct + cookie',
    () => {
      const value = new Headers(headers)
      value.set('cookie', benchInputs.request.cookie)
      return [...value]
    },
    3000,
    5,
    headers.length,
  )
  await measure(
    'Headers',
    'JS Map construct + cookie',
    () => {
      const value = new Map(headers.map(([key, value]) => [key.toLowerCase(), value]))
      value.set('cookie', benchInputs.request.cookie)
      return [...value]
    },
    3000,
    5,
    headers.length,
  )
  await measure(
    'Request',
    'Deno',
    () => new Request(absolute, { headers }),
    1000,
    1,
    absolute.length,
  )
  await measure('AbortController', 'Deno', () => new AbortController(), 3000, 11, 0)
  await measure(
    'structuredClone',
    'Deno',
    () => structuredClone([{ date: new Date(0) }, { teams: ['a', 'b'] }]),
    3000,
    1,
    2,
  )
  await measure(
    'ReadableStream',
    'Deno',
    async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(127))
          controller.close()
        },
      })
      const reader = stream.getReader()
      await reader.read()
      await reader.read()
      reader.releaseLock()
    },
    1000,
    1,
    127,
  )
  await measure(
    'TransformStream',
    'Deno',
    async () => {
      const stream = new TransformStream()
      const reader = stream.readable.getReader()
      const writer = stream.writable.getWriter()
      const write = writer.write(new Uint8Array(127))
      await reader.read()
      await write
      const close = writer.close()
      await reader.read()
      await close
      writer.releaseLock()
      reader.releaseLock()
    },
    500,
    1,
    127,
  )

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Tallinn',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  })
  const times = [
    ...new Set(
      bodies.flatMap((bytes) =>
        [...decoder.decode(bytes).matchAll(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g)].map(
          ([value]) => Math.floor(Date.parse(value) / 1000) * 1000,
        ),
      ),
    ),
  ].slice(0, 256)
  if (times.length === 0) times.push(benchInputs.request.now)
  const partsCache = new Map()
  let index = 0
  function cachedParts(time) {
    const found = partsCache.get(time)
    if (found) return found.map((part) => ({ ...part }))
    const parts = formatter.formatToParts(time)
    if (partsCache.size === 256) partsCache.delete(partsCache.keys().next().value)
    partsCache.set(
      time,
      parts.map((part) => ({ ...part })),
    )
    return parts
  }
  for (const time of times) equal(cachedParts(time), formatter.formatToParts(time), 'cached Intl')
  const mutatable = cachedParts(times[0])
  mutatable[0].value = 'changed'
  equal(cachedParts(times[0]), formatter.formatToParts(times[0]), 'fresh Intl parts')
  await measure(
    'Intl.DateTimeFormat.formatToParts',
    'V8 ICU',
    () => formatter.formatToParts(times[index++ % times.length]),
    3000,
    times.length,
    times.length,
  )
  await measure(
    'Intl.DateTimeFormat.formatToParts',
    'bounded JS cache + fresh parts',
    () => cachedParts(times[index++ % times.length]),
    3000,
    times.length,
    times.length,
  )

  for (const row of rows) Deno.core.print(JSON.stringify(row) + '\n')
})()

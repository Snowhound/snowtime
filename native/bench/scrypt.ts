import { scryptSync } from 'node:crypto'

const count = Number(process.argv[2] ?? 30)
if (!Number.isInteger(count) || count < 20) throw new Error('Use at least 20 hashes')
const password = 'snowtime-local'.normalize('NFKC')
const salt = '071710cd2c2fa1763453bf1482dca2da'
const expected =
  'edb03c843c67154697aceae268c793e9b949c9e39e0d444f9e4ecef881a2019028249ad4a1a9ab13ed7fd25a176bf57e83182606e561598f447bc6e3d2996296'
const samples: number[] = []
for (let i = 0; i < count + 3; i++) {
  const start = performance.now()
  const key = scryptSync(password, salt, 64, { N: 16384, r: 16, p: 1, maxmem: 64 * 1024 * 1024 })
  const ms = performance.now() - start
  if (key.toString('hex') !== expected) throw new Error('Different hash')
  if (i >= 3) samples.push(ms)
}
samples.sort((a, b) => a - b)
const median = (samples[Math.floor((count - 1) / 2)] + samples[Math.floor(count / 2)]) / 2
console.log(
  `Bun ${Bun.version}: n=${count}, median=${median.toFixed(3)} ms, min=${samples[0].toFixed(3)}, max=${samples[count - 1].toFixed(3)}`,
)

import { randomBytes } from 'node:crypto'

/**
 * RFC 9562 UUID v7, the shape Postgres 18's uuidv7() issues for every row id (spec 0002, "Conventions": Keys): 48 bits
 * of Unix milliseconds, the version and variant bits, the rest random. For the ids the app issues itself, Better
 * Auth's above all (src/platform/auth/auth.ts), so a login's id sorts with the rows written around it.
 * @public
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16)
  const ms = BigInt(now)
  for (let i = 0; i < 6; i++) {
    bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn)
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

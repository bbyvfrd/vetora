/**
 * RFC 9562 UUID v7, the ids the app gives what it creates (spec 0001, "API conventions": safe retries): made once when
 * a form opens and sent with every try, so a retry or a double click changes nothing. 48 bits of Unix milliseconds,
 * the version and variant bits, the rest random, as the API's own `uuidv7()` and Postgres issue them.
 */
export function uuidv7(now: number = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let ms = now
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ms % 256
    ms = Math.floor(ms / 256)
  }
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

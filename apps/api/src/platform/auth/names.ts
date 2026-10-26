/**
 * The names a login is made of (GLOSSARY.md, "Terms added since domain.md"): a practice code (the registry's slug,
 * Clinic code on screen) and a handle (Username on screen) inside it. Together they are the login's username,
 * `handle@practice-code`, unique across practices because the code is; the sign in page asks for the two apart and
 * joins them (spec #18, "Identity and access").
 */

/**
 * A practice code: lower case letters and digits, hyphens between them, 64 at most (the registry's slug).
 * @public
 */
export const PRACTICE_CODE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * A handle: a lower case letter or digit, then up to 29 letters, digits, dots and underscores.
 * @public
 */
export const HANDLE = /^[a-z0-9][a-z0-9._]{0,29}$/

/** `handle@practice-code`: 30 + 1 + 64 characters at most. */
export const USERNAME = new RegExp(`^${HANDLE.source.slice(1, -1)}@${PRACTICE_CODE.source.slice(1, -1)}$`)
export const MAX_USERNAME_LENGTH = 95

/**
 * The username a handle signs in with at its practice.
 * @public
 */
export function usernameOf(handle: string, practiceCode: string): string {
  return `${handle}@${practiceCode}`
}

/**
 * The email Better Auth requires on every login: a placeholder under the reserved `.invalid` domain (RFC 2606), so it
 * can never receive mail; nothing in vetora writes to staff by email.
 */
export function placeholderEmail(handle: string, practiceCode: string): string {
  return `${handle}@${practiceCode}.staff.invalid`
}

import { queryOptions } from '@tanstack/react-query'
import type { Me } from '@vetora/contracts'
import { api } from './api/client'

/**
 * Who is signed in, and signing in and out (spec #18, "Web app"): `/api/me` is the app's first call after sign in and
 * the shell's guard, and the clinic code is remembered on the computer after a successful sign in, so at a shared desk
 * each person types only their username and password (story 2). The session itself is Better Auth's httpOnly cookie,
 * which the page never sees.
 */

/** `/api/me` said there is no session: never signed in on this computer, signed out, or ended after 12 hours. */
export class SignedOut extends Error {
  constructor() {
    super('not signed in')
    this.name = 'SignedOut'
  }
}

export const meQuery = queryOptions({
  queryKey: ['me'] as const,
  queryFn: async (): Promise<Me> => {
    const { data, response } = await api.GET('/api/me')
    if (response.status === 401) throw new SignedOut()
    if (!data) throw new Error(`/api/me answered ${response.status}`)
    return data
  },
  // Asked again when the window regains focus after this long, which also finds a session that has ended.
  staleTime: 5 * 60_000,
  retry: false,
})

const clinicCodeKey = 'vetora.clinicCode'

/** The clinic code this computer last signed in with, or ''. */
export function rememberedClinicCode(): string {
  try {
    return localStorage.getItem(clinicCodeKey) ?? ''
  } catch {
    return ''
  }
}

function rememberClinicCode(code: string): void {
  try {
    localStorage.setItem(clinicCodeKey, code)
  } catch {
    // storage may be unavailable (private mode); the code is then typed again next time
  }
}

/** How a sign in ended: in, refused (one answer whichever part was wrong, story 4), or no connection. */
export type SignInResult = 'signed-in' | 'refused' | 'offline'

/** The form a login's two names take on the wire: lower case, without stray spaces, joined as `handle@code`. */
const normalised = (value: string) => value.trim().toLowerCase()

/** Sign in with the three fields of the sign in page; the clinic code is remembered when it works. */
export async function signIn(clinicCode: string, username: string, password: string): Promise<SignInResult> {
  const code = normalised(clinicCode)
  try {
    const { response } = await api.POST('/api/auth/sign-in/username', {
      body: { username: `${normalised(username)}@${code}`, password },
    })
    if (response.status !== 204) return 'refused'
  } catch {
    return 'offline'
  }
  rememberClinicCode(code)
  return 'signed-in'
}

/** End the session; the page goes to the sign in page whatever the answer, since the session is no use either way. */
export async function signOut(): Promise<void> {
  try {
    await api.POST('/api/auth/sign-out')
  } catch {
    // no connection: the cookie stays until it ends, and the sign in page is shown all the same
  }
}

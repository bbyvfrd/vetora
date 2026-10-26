import { createFileRoute } from '@tanstack/react-router'
import { SignInPage } from '../pages/SignInPage'

/** `?ended=true` when the session ended under the person (error.session): a flag, nothing personal (spec 0001). */
export const Route = createFileRoute('/sign-in')({
  validateSearch: (search: Record<string, unknown>): { ended?: true } =>
    search.ended === true || search.ended === 'true' ? { ended: true } : {},
  component: SignInPage,
})

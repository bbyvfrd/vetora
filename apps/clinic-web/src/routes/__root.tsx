import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'

/**
 * The root: nothing of its own. The signed in pages sit in the shell of `_app.tsx`, behind its guard; the sign in page
 * (`sign-in.tsx`) sits outside it (spec #18, "Web app"). The query client travels in the router's context, so the
 * guard reads `/api/me` from the same cache the pages do.
 */
export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({ component: Outlet })

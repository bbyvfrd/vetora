import type { QueryClient } from '@tanstack/react-query'
import { createRouter, type RouterHistory } from '@tanstack/react-router'
import { whenUnauthorized } from './api/client'
import { routeTree } from './routeTree.gen'
import { meQuery } from './session'

/**
 * The app's router, as main.tsx and the DOM tests make it: the route tree with the query client in its context (the
 * shell's guard reads `/api/me` through it), and the session's end handled once for every request. A 401 from a vetora
 * route after the person was signed in means the session has ended: what was cached for them goes, and the sign in
 * page says so (error.session). A 401 before anyone signed in is the guard's to answer, with no message.
 */
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  const router = createRouter({ routeTree, context: { queryClient }, ...(history ? { history } : {}) })
  whenUnauthorized(() => {
    if (queryClient.getQueryData(meQuery.queryKey) === undefined) return
    queryClient.clear()
    void router.navigate({ to: '/sign-in', search: { ended: true } })
  })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}

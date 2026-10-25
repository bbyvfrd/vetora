import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
// The design system's stylesheet (tokens, components, Roboto), once; the app has no stylesheet of its own.
import '@vetora/ui/styles.css'
import { routeTree } from './routeTree.gen'
import { initErrorReporting } from './sentry'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const queryClient = new QueryClient()

void initErrorReporting()

const root = document.getElementById('root')
if (!root) throw new Error('The #root element is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)

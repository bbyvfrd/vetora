import { createRoute } from '@hono/zod-openapi'
import { HealthResponse } from '@vetora/contracts'

export const healthRoute = createRoute({
  method: 'get',
  path: '/api/health',
  summary: 'Service health',
  description: 'Reports the API version and whether the database answers. Used by the web app shell and by uptime checks.',
  responses: {
    200: {
      description: 'The API and its database are up',
      content: { 'application/json': { schema: HealthResponse } },
    },
    503: {
      description: 'The database does not answer (problem details)',
    },
  },
})

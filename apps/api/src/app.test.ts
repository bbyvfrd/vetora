import { describe, expect, it } from 'vitest'
import { app } from './app.js'

describe('the API shell', () => {
  it('answers /up without the database and tags the response with a request id', async () => {
    const response = await app.request('/up')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('OK')
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('answers an unknown path with problem details JSON', async () => {
    const response = await app.request('/nope')
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toBe('application/problem+json')
    expect(await response.json()).toMatchObject({
      type: 'about:blank',
      title: 'Not found',
      status: 404,
      instance: '/nope',
      requestId: expect.any(String),
    })
  })

  it('publishes an OpenAPI 3.1 document that holds the health route', async () => {
    const response = await app.request('/api/openapi.json')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ openapi: '3.1.0', paths: { '/api/health': expect.anything() } })
  })
})

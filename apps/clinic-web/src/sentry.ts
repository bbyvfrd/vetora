import * as Sentry from '@sentry/react'

/** Values the web container writes to /config.json at start (Kamal env), so nothing is baked into the image. */
type RuntimeConfig = {
  sentryDsn?: string
  environment?: string
  release?: string
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store' })
    if (!response.ok) return {}
    return (await response.json()) as RuntimeConfig
  } catch {
    return {}
  }
}

function stripQuery(url: string | undefined): string | undefined {
  return url?.split('?')[0]
}

/** Error reporting (spec 0001, "Errors"): no personal data, no query strings, no request bodies. */
export async function initErrorReporting(): Promise<void> {
  const config = await loadRuntimeConfig()
  if (!config.sentryDsn) return
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.environment ?? 'local',
    ...(config.release ? { release: config.release } : {}),
    tracesSampleRate: 0,
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    beforeSend(event) {
      if (event.request) {
        event.request = { url: stripQuery(event.request.url) }
      }
      delete event.user
      return event
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.data) {
        for (const key of ['url', 'from', 'to']) {
          if (typeof breadcrumb.data[key] === 'string') breadcrumb.data[key] = stripQuery(breadcrumb.data[key])
        }
      }
      return breadcrumb
    },
  })
}

import { useQuery } from '@tanstack/react-query'
import { Button } from '@vetora/ui'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'

/**
 * The status page, the home route until sign in arrives: polls `GET /api/health` every 30 s and shows the answer;
 * "Try again" asks at once. Its four states come with ticket #11 and the shell around it with #12 (spec #9).
 */
export function StatusPage() {
  const { t } = useTranslation()
  const health = useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const { data, error, response } = await api.GET('/api/health')
      if (error || !data) throw new Error(`health check failed with status ${response.status}`)
      return data
    },
    refetchInterval: 30_000,
    retry: false,
  })

  return (
    <section aria-live="polite">
      <h2>{t('health.title')}</h2>
      {health.isPending && <p>{t('health.checking')}</p>}
      {health.isError && <p role="status">{t('health.unavailable')}</p>}
      {health.data && (
        <p role="status">
          {t('health.ok')} · {t('health.version')} {health.data.version}
        </p>
      )}
      <Button icon="refresh" onClick={() => void health.refetch()}>
        {t('health.retry')}
      </Button>
    </section>
  )
}

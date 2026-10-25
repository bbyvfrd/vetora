import { useQuery } from '@tanstack/react-query'
import { Badge, Banner, Skeleton } from '@vetora/ui'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'

/**
 * The status page, the home route until sign in arrives: polls `GET /api/health` every 30 s and shows the answer in
 * the brand book's page states (spec #9, ticket #11): a skeleton in the shape of the status line, the region busy,
 * while the first check is in flight; a danger banner first in the page, offering "Try again", when the API cannot be
 * reached, on the first check or a later poll; a success badge with the version while it answers. One state at a
 * time: the query keeps its last answer beside a later error, so the badge follows the query's success state, not
 * the presence of data. The shell around it arrives with ticket #12.
 */
export function StatusPage() {
  const { t } = useTranslation()
  const titleId = useId()
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
    <section aria-labelledby={titleId} aria-busy={health.isPending || undefined}>
      {health.isError && (
        <Banner
          status="danger"
          title={t('health.loadFailed')}
          action={{ label: t('health.retry'), onClick: () => void health.refetch() }}
        />
      )}
      <h2 id={titleId}>{t('health.title')}</h2>
      {health.isPending && (
        <p>
          <Skeleton width={200} />
        </p>
      )}
      {health.isSuccess && (
        <p role="status">
          <Badge status="success" icon="check_circle">
            {t('health.ok')}
          </Badge>{' '}
          {t('health.version')} {health.data.version}
        </p>
      )}
    </section>
  )
}

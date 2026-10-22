import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
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
    </section>
  )
}

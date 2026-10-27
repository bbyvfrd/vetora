import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { can, type VisitsToday } from '@vetora/contracts'
import { Badge, Banner, Button, EmptyState, formatTime, PageBody, PageHeader, Skeleton, Table } from '@vetora/ui'
import { useTranslation } from 'react-i18next'
import { visitsTodayQuery } from '../api/visits'
import { fullName } from '../names'
import { meQuery } from '../session'
import { wallClock } from '../time'

/**
 * Visits today, the signed in home (spec #18, "Web app"; story 28), a list page whose primary action is New visit
 * (#21), shown to the roles that may register a client and a pet: the day's visits at the person's location, newest
 * first, each with its patient, client, vet, the time it started in the practice's clock and whether it is a draft or
 * completed, a row opening the visit (#22). Asked again every 30 seconds until the schedule's live updates arrive
 * (slice 5). A groomer reads none of it (story 72) and sees the empty page.
 */

type Row = VisitsToday['visits'][number]

export function VisitsTodayPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: me } = useSuspenseQuery(meQuery)
  const reads = can(me.practice.roles, 'readRecords')
  const visits = useQuery({ ...visitsTodayQuery(me), enabled: reads })
  const newVisit = can(me.practice.roles, 'registerClientsAndPatients') ? (
    <Button variant="primary" icon="add" onClick={() => void navigate({ to: '/visits/new' })}>
      {t('visitsToday.newVisit')}
    </Button>
  ) : null

  const columns = [
    {
      key: 'startedAt',
      header: t('visitsToday.time'),
      numeric: true,
      render: (row: Row) => formatTime(wallClock(row.startedAt, me.practice.timeZone)),
    },
    { key: 'patient', header: t('visitsToday.patient'), render: (row: Row) => row.patient.name },
    { key: 'client', header: t('visitsToday.client'), render: (row: Row) => fullName(row.client) },
    { key: 'vet', header: t('visitsToday.vet'), render: (row: Row) => row.veterinarian.displayName },
    {
      key: 'status',
      header: t('visitsToday.status'),
      render: (row: Row) =>
        row.status === 'finalised' ? (
          <Badge status="success" icon="check_circle">
            {t('visit.status.finalised')}
          </Badge>
        ) : (
          <Badge>{t('visit.status.draft')}</Badge>
        ),
    },
  ]

  return (
    <>
      <PageHeader title={t('visitsToday.title')} actions={newVisit} />
      <PageBody>
        <section aria-label={t('visitsToday.title')} aria-busy={(reads && visits.isPending) || undefined}>
          {visits.isError ? (
            <Banner
              status="danger"
              title={t('error.load.title')}
              action={{ label: t('error.load.button'), onClick: () => void visits.refetch() }}
            >
              {t('error.load.body')}
            </Banner>
          ) : null}
          {reads && visits.isPending ? <Skeleton variant="block" lines={3} /> : null}
          {!reads || visits.data?.visits.length === 0 ? (
            <EmptyState icon="stethoscope" title={t('empty.visitsToday.title')} />
          ) : null}
          {visits.data && visits.data.visits.length > 0 ? (
            <Table
              caption={t('visitsToday.title')}
              columns={columns}
              rows={visits.data.visits}
              rowKey={(row: Row) => row.id}
              onRowClick={(row: Row) => void navigate({ to: '/visits/$visitId', params: { visitId: row.id } })}
            />
          ) : null}
        </section>
      </PageBody>
    </>
  )
}

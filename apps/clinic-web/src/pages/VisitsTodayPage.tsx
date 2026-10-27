import { useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { can } from '@vetora/contracts'
import { Button, EmptyState, PageBody, PageHeader } from '@vetora/ui'
import { useTranslation } from 'react-i18next'
import { meQuery } from '../session'

/**
 * Visits today, the signed in home (spec #18, "Web app"; the empty half of story 28): a list page whose primary action
 * is New visit (#21), shown to the roles that may register a client and a pet (the matrix, as the API checks it). The
 * list arrives with the visit itself (the spec's third ticket); until then it shows its empty state.
 */
export function VisitsTodayPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: me } = useSuspenseQuery(meQuery)
  const newVisit = can(me.practice.roles, 'registerClientsAndPatients') ? (
    <Button variant="primary" icon="add" onClick={() => void navigate({ to: '/visits/new' })}>
      {t('visitsToday.newVisit')}
    </Button>
  ) : null
  return (
    <>
      <PageHeader title={t('visitsToday.title')} actions={newVisit} />
      <PageBody>
        <EmptyState icon="stethoscope" title={t('empty.visitsToday.title')} />
      </PageBody>
    </>
  )
}

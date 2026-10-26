import { EmptyState, PageBody, PageHeader } from '@vetora/ui'
import { useTranslation } from 'react-i18next'

/**
 * Visits today, the signed in home (spec #18, "Web app"; the empty half of story 28): a list page whose list and New
 * visit arrive with the visit itself (the spec's third ticket); until then it shows its empty state.
 */
export function VisitsTodayPage() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('visitsToday.title')} />
      <PageBody>
        <EmptyState icon="stethoscope" title={t('empty.visitsToday.title')} />
      </PageBody>
    </>
  )
}

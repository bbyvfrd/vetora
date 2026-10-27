import { createFileRoute } from '@tanstack/react-router'
import { VisitPage } from '../../pages/VisitPage'

export const Route = createFileRoute('/_app/visits/$visitId')({ component: VisitRoute })

function VisitRoute() {
  const { visitId } = Route.useParams()
  return <VisitPage visitId={visitId} />
}

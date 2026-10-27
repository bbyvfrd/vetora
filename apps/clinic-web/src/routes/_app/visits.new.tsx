import { createFileRoute } from '@tanstack/react-router'
import { NewVisitPage } from '../../pages/NewVisitPage'

export const Route = createFileRoute('/_app/visits/new')({ component: NewVisitPage })

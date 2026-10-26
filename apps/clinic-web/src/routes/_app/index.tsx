import { createFileRoute } from '@tanstack/react-router'
import { VisitsTodayPage } from '../../pages/VisitsTodayPage'

export const Route = createFileRoute('/_app/')({ component: VisitsTodayPage })

import { createFileRoute } from '@tanstack/react-router'
import { StatusPage } from '../../pages/StatusPage'

export const Route = createFileRoute('/_app/status')({ component: StatusPage })

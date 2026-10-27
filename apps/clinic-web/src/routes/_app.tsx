import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import type { StaffRole } from '@vetora/contracts'
import { AppShell, Banner, NavRail, PageBody, Toaster } from '@vetora/ui'
import { type MouseEvent, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import logo from '../assets/vetora-logo-horizontal-reversed.svg'
import { setLanguage } from '../i18n'
import { meQuery, SignedOut } from '../session'

/**
 * The signed in pages: the guard asks `/api/me` before any of them loads and sends a person with no session to the
 * sign in page (spec #18, "Web app"), and the shell frames them all.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    try {
      await context.queryClient.ensureQueryData(meQuery)
    } catch (error) {
      if (error instanceof SignedOut) throw redirect({ to: '/sign-in' })
      throw error
    }
  },
  component: AppLayout,
  errorComponent: LoadFailed,
})

/**
 * The places the rail lists: routed ones only, each arriving with its slice (spec #9, "The shell replaces the
 * placeholder"): Visits today, the signed in home, then the status page. An item's label is its page's title key, and
 * its icon comes from the set by meaning.
 */
const places = [
  { id: 'visits', to: '/', icon: 'stethoscope', title: 'visitsToday.title' },
  { id: 'status', to: '/status', icon: 'info', title: 'health.title' },
] as const

/** A click meant for this page: the main button with no modifier, so a new tab or a copied address work as for any link. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * The frame of every signed in screen (ticket #12): the design system's AppShell with the rail on the left, its brand
 * the reversed logo, one section of routed places, and at its foot the account entry (spec #18): the person's name,
 * their roles and clinic under it, opening their profile, where their language and Sign out are. The interface
 * speaks the language saved to their login, whatever this computer chose before (story 12).
 */
function AppLayout() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
  const { data: me } = useSuspenseQuery(meQuery)

  useEffect(() => {
    if (i18n.language !== me.language) setLanguage(me.language)
  }, [i18n.language, me.language])

  const go = (to: string) => (event: MouseEvent) => {
    if (!isPlainClick(event)) return
    event.preventDefault()
    void navigate({ to })
  }
  const roles = me.practice.roles.map((role: StaffRole) => t(`role.${role}`)).join(', ')

  return (
    <AppShell
      skipLabel={t('shell.skipToContent')}
      nav={
        <NavRail
          label={t('shell.navigation')}
          brand={<img src={logo} alt={t('app.name')} />}
          sections={[
            {
              items: places.map((place) => ({ id: place.id, label: t(place.title), icon: place.icon, href: place.to })),
            },
          ]}
          activeId={places.find((place) => place.to === pathname)?.id}
          onNavigate={(id, event) => {
            const place = places.find((item) => item.id === id)
            if (place) go(place.to)(event)
          }}
          account={{
            name: me.displayName,
            detail: `${roles} · ${me.practice.name}`,
            href: '/profile',
            onClick: go('/profile'),
          }}
        />
      }
    >
      <Outlet />
      {/* The one toaster of the signed in pages: a confirmation outlives the page that saved (New visit's Save). */}
      <Toaster label={t('notifications.label')} closeLabel={t('action.close')} />
    </AppShell>
  )
}

/** `/api/me` could not be read (no connection, or no practice for the login): the page says so and offers again. */
function LoadFailed() {
  const { t } = useTranslation()
  const router = useRouter()
  return (
    <main>
      <PageBody>
        <Banner
          status="danger"
          title={t('error.load.title')}
          action={{ label: t('error.load.button'), onClick: () => void router.invalidate() }}
        >
          {t('error.load.body')}
        </Banner>
      </PageBody>
    </main>
  )
}

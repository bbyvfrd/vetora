import { createRootRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { isLanguage, languageNames, languages } from '@vetora/i18n'
import { AppShell, NavRail, Select } from '@vetora/ui'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import logo from '../assets/vetora-logo-horizontal-reversed.svg'
import { setLanguage } from '../i18n'

export const Route = createRootRoute({ component: RootLayout })

/**
 * The places the rail lists: routed ones only, each arriving with its slice (spec #9, "The shell replaces the
 * placeholder"), so the list starts with the status page, the home route until sign in. An item's label is its page's
 * title key, and its icon comes from the set by meaning.
 */
const places = [{ id: 'status', to: '/', icon: 'info', title: 'health.title' }] as const

/** A click meant for this page: the main button with no modifier, so a new tab or a copied address work as for any link. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * The frame of every screen (ticket #12): the design system's AppShell with the rail on the left, its brand the
 * reversed logo, one section of routed places, and the language switch in the rail's foot until the account entry of
 * feature 5 takes it over. The page itself renders a PageHeader and a PageBody.
 */
function RootLayout() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const pathname = useLocation({ select: (location) => location.pathname })
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
            if (!isPlainClick(event)) return
            event.preventDefault()
            const place = places.find((item) => item.id === id)
            if (place) void navigate({ to: place.to })
          }}
          footer={
            <Select
              label={t('language.label')}
              hideLabel
              value={i18n.language}
              onChange={(event) => {
                if (isLanguage(event.target.value)) setLanguage(event.target.value)
              }}
              options={languages.map((language) => ({ value: language, label: languageNames[language] }))}
            />
          }
        />
      }
    >
      <Outlet />
    </AppShell>
  )
}

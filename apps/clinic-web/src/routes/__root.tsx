import { createRootRoute, Outlet } from '@tanstack/react-router'
import { type Language, languageNames, languages } from '@vetora/i18n'
import { useTranslation } from 'react-i18next'
import { setLanguage } from '../i18n'

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  const { t, i18n } = useTranslation()
  return (
    <>
      <header className="app-header">
        <h1>{t('app.name')}</h1>
        <label>
          {t('language.label')}{' '}
          <select value={i18n.language} onChange={(event) => setLanguage(event.target.value as Language)}>
            {languages.map((language) => (
              <option key={language} value={language}>
                {languageNames[language]}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}

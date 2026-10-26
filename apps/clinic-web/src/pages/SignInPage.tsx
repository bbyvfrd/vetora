import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { languageNames, languages } from '@vetora/i18n'
import { AuthLayout, Banner, Button, TextField } from '@vetora/ui'
import { type ChangeEvent, type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import logo from '../assets/vetora-logo-stacked-reversed.svg'
import { setLanguage } from '../i18n'
import { meQuery, rememberedClinicCode, type SignInResult, signIn } from '../session'

type Field = 'clinicCode' | 'username' | 'password'

/**
 * The sign in page (spec #18, "Web app"; stories 1 to 4 and 7), outside the shell, as the design system's SignInPage
 * example lays it out: the stacked logo and its line, the clinic code (filled from this computer's last sign in), the
 * username and the password, one button, the line about a forgotten password, and the language choice in the three
 * languages' own names, which changes the page at once and is kept on this computer. A refusal is one message that
 * names none of the three as the wrong one, and clears the password; a session that ended says so here.
 */
export function SignInPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { ended } = useSearch({ from: '/sign-in' })
  const [values, setValues] = useState<Record<Field, string>>(() => ({
    clinicCode: rememberedClinicCode(),
    username: '',
    password: '',
  }))
  const [missing, setMissing] = useState<Field[]>([])
  const [failure, setFailure] = useState<Exclude<SignInResult, 'signed-in'>>()
  const [busy, setBusy] = useState(false)

  const change = (field: Field) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues((current) => ({ ...current, [field]: event.target.value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const empty = (Object.keys(values) as Field[]).filter((field) => values[field].trim() === '')
    setMissing(empty)
    if (empty.length > 0) return
    setBusy(true)
    setFailure(undefined)
    const result = await signIn(values.clinicCode, values.username, values.password)
    if (result !== 'signed-in') {
      setBusy(false)
      setFailure(result)
      if (result === 'refused') setValues((current) => ({ ...current, password: '' }))
      return
    }
    // Nothing of an earlier person stays; the app then speaks this person's language from the first page.
    queryClient.clear()
    try {
      setLanguage((await queryClient.fetchQuery(meQuery)).language)
    } catch {
      // the shell's guard asks again and shows what went wrong
    }
    await navigate({ to: '/' })
  }

  const fieldError = (field: Field) => (missing.includes(field) ? t('field.required') : undefined)

  return (
    <AuthLayout
      title={t('signin.title')}
      brand={
        <>
          <img src={logo} alt={t('app.name')} />
          <p>{t('signin.brandLine')}</p>
        </>
      }
      onSubmit={submit}
      footer={
        // Layout glue only: the three buttons in a row, without the browser's fieldset frame.
        <fieldset
          aria-label={t('language.label')}
          style={{ display: 'flex', gap: 'var(--space-1)', margin: 0, padding: 0, border: 0, minWidth: 0 }}
        >
          {languages.map((language) => (
            <Button
              key={language}
              variant="ghost"
              size="sm"
              lang={language}
              aria-pressed={i18n.language === language}
              onClick={() => setLanguage(language)}
            >
              {languageNames[language]}
            </Button>
          ))}
        </fieldset>
      }
    >
      {failure === 'refused' && (
        <Banner status="danger" title={t('error.signin.title')}>
          {t('error.signin.body')}
        </Banner>
      )}
      {failure === 'offline' && (
        <Banner status="danger" title={t('error.offline.title')}>
          {t('error.offline.body')}
        </Banner>
      )}
      {ended && !failure && (
        <Banner status="danger" title={t('error.session.title')}>
          {t('error.session.body')}
        </Banner>
      )}
      <TextField
        label={t('signin.clinicCode')}
        name="clinic-code"
        autoComplete="organization"
        autoCapitalize="none"
        spellCheck={false}
        value={values.clinicCode}
        onChange={change('clinicCode')}
        error={fieldError('clinicCode')}
      />
      <TextField
        label={t('signin.username')}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={values.username}
        onChange={change('username')}
        error={fieldError('username')}
      />
      <TextField
        label={t('signin.password')}
        name="password"
        type="password"
        autoComplete="current-password"
        value={values.password}
        onChange={change('password')}
        error={fieldError('password')}
      />
      <Button variant="primary" size="lg" fullWidth type="submit" loading={busy}>
        {busy ? t('signin.submitting') : t('signin.submit')}
      </Button>
      <p>{t('signin.forgot')}</p>
    </AuthLayout>
  )
}

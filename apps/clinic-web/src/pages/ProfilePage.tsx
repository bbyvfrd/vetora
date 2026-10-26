import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Language } from '@vetora/contracts'
import { isLanguage, languageNames, languages } from '@vetora/i18n'
import { Button, DetailList, PageBody, PageHeader, Select } from '@vetora/ui'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { setLanguage } from '../i18n'
import { meQuery, signOut } from '../session'

/**
 * The profile, where the rail's account entry opens (spec #18, "Web app"; stories 9, 11 and 12): who is signed in, at
 * which clinic and in which roles, their language, saved to their login so it follows them to any computer, and Sign
 * out, after which the sign in page shows with the clinic code still filled in.
 */
export function ProfilePage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: me } = useSuspenseQuery(meQuery)

  // The page changes at once; a save the API refuses puts the language back as the login holds it.
  const saveLanguage = useMutation({
    mutationFn: async (language: Language) => {
      const { response } = await api.PUT('/api/me/language', { body: { language } })
      if (response.status !== 204) throw new Error(`the language was not saved: ${response.status}`)
    },
    onMutate: (language) => {
      const previous = me.language
      queryClient.setQueryData(meQuery.queryKey, (current) => current && { ...current, language })
      setLanguage(language)
      return { previous }
    },
    onError: (_error, _language, context) => {
      if (!context) return
      queryClient.setQueryData(meQuery.queryKey, (current) => current && { ...current, language: context.previous })
      setLanguage(context.previous)
    },
  })

  async function signOutHere() {
    await signOut()
    await navigate({ to: '/sign-in' })
    queryClient.clear()
  }

  return (
    <>
      <PageHeader
        title={t('account.profile')}
        subtitle={me.displayName}
        actions={
          <Button icon="logout" onClick={() => void signOutHere()}>
            {t('account.signOut')}
          </Button>
        }
      />
      <PageBody width="narrow">
        <DetailList
          items={[
            { label: t('account.clinic'), value: me.practice.name },
            { label: t('account.role'), value: me.practice.roles.map((role) => t(`role.${role}`)).join(', ') },
          ]}
        />
        <Select
          label={t('language.label')}
          value={me.language}
          onChange={(event) => {
            if (isLanguage(event.target.value)) saveLanguage.mutate(event.target.value)
          }}
          options={languages.map((language) => ({ value: language, label: languageNames[language] }))}
        />
      </PageBody>
    </>
  )
}

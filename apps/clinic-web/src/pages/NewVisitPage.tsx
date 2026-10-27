import { zodResolver } from '@hookform/resolvers/zod'
import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  type BreedNames,
  type Me,
  NewClient,
  NewPatient,
  PhoneLookup,
  type PhoneLookupResult,
  type Registration,
  SEXES,
  type SpeciesList,
} from '@vetora/contracts'
import { type Language, languageNames, languages } from '@vetora/i18n'
import {
  Banner,
  Button,
  Card,
  Checkbox,
  Combobox,
  compareText,
  DatePicker,
  FormActions,
  FormSection,
  PageBody,
  PageHeader,
  RadioGroup,
  Select,
  TextField,
  toast,
} from '@vetora/ui'
import { type MouseEvent, useState } from 'react'
import {
  type Control,
  Controller,
  type FieldError,
  type FieldPath,
  type UseFormSetValue,
  useForm,
  useWatch,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { api } from '../api/client'
import { practiceParams } from '../api/practice'
import { uuidv7 } from '../ids'
import { meQuery } from '../session'

/**
 * New visit (#21; spec #18, "Web app" and "Visit and money behaviour": New visit's Save; stories 23 to 26), a form
 * page as the design system's FormPage example lays it out: it starts with the phone, then shows the clients on a
 * known number with their patients and New patient, or the client and patient fields for an unknown one; a new client
 * on a number another client has is warned about and never blocked. Save sends one registration with ids made when
 * the form opened, so a retry changes nothing, shows the toast and returns to Visits today. React Hook Form validates
 * with the contracts' schemas. Start visit joins Save with the visit (#22).
 */

type Species = SpeciesList['species'][number]

/** A name in the screen's language, else in another: a breed added inline has only the one it was typed in. */
const nameIn = (names: BreedNames, language: string) =>
  names[language as Language] ?? names.az ?? names.ru ?? names.en ?? ''

const speciesQuery = (me: Me) =>
  queryOptions({
    queryKey: ['species', me.practice.id] as const,
    queryFn: async (): Promise<SpeciesList> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/species', { params: practiceParams(me) })
      if (!data) throw new Error(`species answered ${response.status}`)
      return data
    },
  })

/** Blank text is no value: the optional fields send null, as the API stores them. */
const blankToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value)

/** Today in the browser, `YYYY-MM-DD`: the latest birth date the picker offers; the API holds the practice's today. */
function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The client and patient fields, validated with the contracts' schemas; the ids and the phone are the page's. */
const RegistrationFields = z.object({
  client: NewClient.pick({ firstName: true, lastName: true, preferredLanguage: true })
    .extend({ patronymic: z.preprocess(blankToNull, NewClient.shape.patronymic) })
    .optional(),
  patient: NewPatient.pick({
    name: true,
    speciesId: true,
    sex: true,
    birthDateIsEstimate: true,
    isNeutered: true,
  }).extend({
    breedId: z.preprocess(blankToNull, NewPatient.shape.breedId),
    birthDate: z.preprocess(
      blankToNull,
      NewPatient.shape.birthDate.refine((date) => !date || date <= todayIso(), { message: 'future' }),
    ),
    colour: z.preprocess(blankToNull, NewPatient.shape.colour),
    microchipNumber: z.preprocess(blankToNull, NewPatient.shape.microchipNumber),
  }),
})
type RegistrationInput = z.input<typeof RegistrationFields>
type RegistrationValues = z.output<typeof RegistrationFields>

/** What the page shows under the phone: the clients a known number found, then a registration's fields. */
type Step = { kind: 'phone' } | { kind: 'found' } | { kind: 'new-client' } | { kind: 'new-patient'; clientId: string }

type Found = { phone: string; result: PhoneLookupResult }

/** A person's full name as the clinic writes it: last name, first name, patronymic. */
const fullName = (client: { firstName: string | null; lastName: string | null; patronymic: string | null }) =>
  [client.lastName, client.firstName, client.patronymic].filter(Boolean).join(' ')

export function NewVisitPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: me } = useSuspenseQuery(meQuery)
  // Asked for at once, so the species are there by the time the fields or a found client's patients show.
  const catalog = useQuery(speciesQuery(me))
  const [found, setFound] = useState<Found>()
  const [step, setStep] = useState<Step>({ kind: 'phone' })

  const toVisitsToday = (event?: MouseEvent) => {
    event?.preventDefault()
    void navigate({ to: '/' })
  }
  const registering = step.kind === 'new-client' || step.kind === 'new-patient'

  return (
    <>
      <PageHeader
        title={t('newVisit.title')}
        back={{ label: t('visitsToday.title'), href: '/', onClick: toVisitsToday }}
      />
      <PageBody width="narrow">
        {catalog.isError ? (
          <Banner
            status="danger"
            title={t('error.load.title')}
            action={{ label: t('error.load.button'), onClick: () => void catalog.refetch() }}
          >
            {t('error.load.body')}
          </Banner>
        ) : null}
        <PhoneSearch
          me={me}
          onFound={(phone, result) => {
            setFound({ phone, result })
            setStep(result.clients.length > 0 ? { kind: 'found' } : { kind: 'new-client' })
          }}
        />
        {found && found.result.clients.length > 0 ? (
          <FoundClients
            species={catalog.data?.species ?? []}
            found={found.result}
            onNewPatient={(clientId) => setStep({ kind: 'new-patient', clientId })}
            onNewClient={() => setStep({ kind: 'new-client' })}
          />
        ) : null}
        {found && registering ? (
          <RegistrationForm
            // A new form, with new ids, for each number and each choice.
            key={`${found.phone}:${step.kind === 'new-patient' ? step.clientId : 'new'}`}
            me={me}
            species={catalog.data?.species ?? []}
            phone={found.phone}
            client={step.kind === 'new-patient' ? { type: 'existing', id: step.clientId } : { type: 'new' }}
            shared={step.kind === 'new-client' && found.result.clients.length > 0}
            onSaved={() => {
              toast({ title: t('toast.patient.saved'), status: 'success' })
              toVisitsToday()
            }}
          />
        ) : null}
      </PageBody>
      {registering ? (
        <FormActions>
          <Button onClick={() => toVisitsToday()}>{t('newVisit.cancel')}</Button>
          <Button variant="primary" type="submit" form="registration">
            {t('newVisit.save')}
          </Button>
        </FormActions>
      ) : null}
    </>
  )
}

/** The phone the page starts with, looked up by a POST, so the number never reaches a URL (spec 0001). */
function PhoneSearch({ me, onFound }: { me: Me; onFound: (phone: string, result: PhoneLookupResult) => void }) {
  const { t } = useTranslation()
  const { control, handleSubmit } = useForm({ resolver: zodResolver(PhoneLookup), defaultValues: { phone: '' } })
  const lookup = useMutation({
    mutationFn: async ({ phone }: PhoneLookup) => {
      const { data, response } = await api.POST('/api/p/{practiceId}/clients/lookup', {
        params: practiceParams(me),
        body: { phone },
      })
      if (!data) throw new Error(`lookup answered ${response.status}`)
      return data
    },
    // The number as typed, which a new client's contact keeps beside its normalised form.
    onSuccess: (result, { phone }) => onFound(phone, result),
  })
  return (
    <form noValidate onSubmit={handleSubmit((values) => lookup.mutate(values))}>
      {lookup.isError ? (
        <Banner status="danger" title={t('error.load.title')}>
          {t('error.load.body')}
        </Banner>
      ) : null}
      <FormSection title={t('client.phone')} columns={1}>
        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <TextField
              label={t('client.phone')}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              required
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={
                fieldState.error ? (field.value.trim() === '' ? t('field.required') : t('field.phone')) : undefined
              }
            />
          )}
        />
        <div>
          <Button type="submit" icon="search" loading={lookup.isPending}>
            {t('newVisit.search')}
          </Button>
        </div>
      </FormSection>
    </form>
  )
}

/** The clients a known number found, each with the patients they own today, and the way to a new patient or client. */
function FoundClients({
  species,
  found,
  onNewPatient,
  onNewClient,
}: {
  species: Species[]
  found: PhoneLookupResult
  onNewPatient: (clientId: string) => void
  onNewClient: () => void
}) {
  const { t, i18n } = useTranslation()
  const speciesName = (id: string) => {
    const item = species.find((entry) => entry.id === id)
    return item ? nameIn(item.name, i18n.language) : ''
  }
  return (
    <Card
      title={t('newVisit.clients')}
      footer={
        <Button variant="ghost" icon="person_add" onClick={onNewClient}>
          {t('newVisit.newClient')}
        </Button>
      }
    >
      {found.clients.map((client) => (
        <section key={client.id} aria-label={fullName(client)}>
          <h3>{fullName(client)}</h3>
          <ul>
            {client.patients.map((patient) => (
              <li key={patient.id}>
                <span>{patient.name}</span> · <span>{speciesName(patient.speciesId)}</span>
              </li>
            ))}
          </ul>
          <Button variant="ghost" size="sm" icon="add" onClick={() => onNewPatient(client.id)}>
            {t('newVisit.newPatient')}
          </Button>
        </section>
      ))}
    </Card>
  )
}

/** A field's error in words, from the design system's messages: one line that says what to enter. */
function useFieldError() {
  const { t } = useTranslation()
  return (name: FieldPath<RegistrationInput>, error: Pick<FieldError, 'type' | 'message'> | undefined) => {
    if (!error) return undefined
    switch (name) {
      case 'patient.name':
        return t('field.patient.name')
      case 'patient.birthDate':
        return error.message === 'future' ? t('field.birthDate') : t('field.date', { example: t('field.dateExample') })
      case 'patient.microchipNumber':
        return error.type === 'taken' ? t('field.microchipTaken') : t('field.microchip')
      default:
        return t('field.required')
    }
  }
}
type FieldErrorOf = ReturnType<typeof useFieldError>

/** How a save ended: saved, or the one refusal a person can fix here. Anything else is the save's error. */
type SaveOutcome = 'saved' | 'microchip-taken'

type RegistrationFormProps = {
  me: Me
  species: Species[]
  /** The number as typed, which a new client's contact keeps. */
  phone: string
  client: { type: 'existing'; id: string } | { type: 'new' }
  /** Another client already has the number: the warning shows, and saving goes on. */
  shared: boolean
  onSaved: () => void
}

/** The client fields of a new client (when there is one) and the patient fields, saved in one registration. */
function RegistrationForm({ me, species, phone, client, shared, onSaved }: RegistrationFormProps) {
  const { t, i18n } = useTranslation()
  const errorOf = useFieldError()
  // Made once, when the form opens: every try sends the same ids (spec 0001, "API conventions": safe retries).
  const [ids] = useState(() => ({ client: uuidv7(), patient: uuidv7() }))
  const { control, handleSubmit, formState, setError, setValue } = useForm<
    RegistrationInput,
    unknown,
    RegistrationValues
  >({
    resolver: zodResolver(RegistrationFields),
    mode: 'onTouched',
    defaultValues: {
      client:
        client.type === 'new'
          ? { firstName: '', lastName: '', patronymic: '', preferredLanguage: me.language }
          : undefined,
      patient: { name: '', breedId: null, birthDate: '', birthDateIsEstimate: false, colour: '', microchipNumber: '' },
    },
  })
  const save = useMutation({
    mutationFn: async (values: RegistrationValues): Promise<SaveOutcome> => {
      // The client fields are on the form exactly when the client is new, so the schema has them then.
      const fields = values.client as NonNullable<RegistrationValues['client']>
      const body: Registration = {
        client: client.type === 'existing' ? client : { type: 'new', id: ids.client, ...fields, phone },
        patient: { type: 'new', id: ids.patient, ...values.patient },
      }
      const { error, response } = await api.PUT('/api/p/{practiceId}/registrations', {
        params: practiceParams(me),
        body,
      })
      if (response.ok) return 'saved'
      const issues = (error as { errors?: { path?: unknown[]; code?: string }[] } | undefined)?.errors ?? []
      if (issues.some((issue) => issue.path?.join('.') === 'patient.microchipNumber' && issue.code === 'taken')) {
        return 'microchip-taken'
      }
      throw new Error(`registration answered ${response.status}`)
    },
    onSuccess: (outcome) => {
      if (outcome === 'saved') onSaved()
      else setError('patient.microchipNumber', { type: 'taken' }, { shouldFocus: true })
    },
  })
  const invalid = formState.submitCount > 0 && Object.keys(formState.errors).length > 0

  return (
    <form id="registration" noValidate onSubmit={handleSubmit((values) => save.mutate(values))}>
      {shared ? (
        <Banner status="warning" title={t('warning.phoneShared.title')}>
          {t('warning.phoneShared.body')}
        </Banner>
      ) : null}
      {invalid ? <Banner status="danger" title={t('form.check')} /> : null}
      {save.isError && !invalid ? (
        <Banner status="danger" title={t('error.save.title')}>
          {t('error.save.body')}
        </Banner>
      ) : null}
      {client.type === 'new' ? (
        <FormSection title={t('client.title')}>
          <TextInput
            control={control}
            name="client.firstName"
            label={t('client.firstName')}
            required
            errorOf={errorOf}
          />
          <TextInput control={control} name="client.lastName" label={t('client.lastName')} required errorOf={errorOf} />
          <TextInput control={control} name="client.patronymic" label={t('client.patronymic')} errorOf={errorOf} />
          <Controller
            control={control}
            name="client.preferredLanguage"
            render={({ field }) => (
              <Select
                label={t('client.preferredLanguage')}
                name={field.name}
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                options={languages.map((language) => ({ value: language, label: languageNames[language] }))}
              />
            )}
          />
        </FormSection>
      ) : null}
      <PatientFields
        me={me}
        species={species}
        control={control}
        setValue={setValue}
        errorOf={errorOf}
        language={i18n.language}
      />
    </form>
  )
}

type TextName =
  | 'client.firstName'
  | 'client.lastName'
  | 'client.patronymic'
  | 'patient.name'
  | 'patient.colour'
  | 'patient.microchipNumber'

/** A text field bound to the form. */
function TextInput(props: {
  control: Control<RegistrationInput>
  name: TextName
  label: string
  required?: boolean
  errorOf: FieldErrorOf
  inputMode?: 'numeric'
}) {
  const { control, name, label, required, errorOf, inputMode } = props
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextField
          label={label}
          required={required}
          inputMode={inputMode}
          name={field.name}
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={errorOf(name, fieldState.error)}
        />
      )}
    />
  )
}

type PatientFieldsProps = {
  me: Me
  species: Species[]
  control: Control<RegistrationInput>
  setValue: UseFormSetValue<RegistrationInput>
  errorOf: FieldErrorOf
  language: string
}

/** The patient fields: name, species, breed (added inline when missing), sex, birth date, neutered, colour, microchip. */
function PatientFields({ me, species, control, setValue, errorOf, language }: PatientFieldsProps) {
  const { t } = useTranslation()
  return (
    <FormSection title={t('patient.title')}>
      <TextInput control={control} name="patient.name" label={t('patient.name')} required errorOf={errorOf} />
      <Controller
        control={control}
        name="patient.speciesId"
        render={({ field, fieldState }) => (
          <Select
            label={t('patient.species')}
            required
            name={field.name}
            value={field.value ?? ''}
            onChange={(event) => {
              field.onChange(event.target.value)
              // A breed belongs to one species.
              setValue('patient.breedId', null)
            }}
            onBlur={field.onBlur}
            placeholder={t('action.select')}
            options={species.map((item) => ({ value: item.id, label: nameIn(item.name, language) }))}
            error={errorOf('patient.speciesId', fieldState.error)}
          />
        )}
      />
      <BreedField me={me} species={species} control={control} language={language} />
      <Controller
        control={control}
        name="patient.sex"
        render={({ field, fieldState }) => (
          <RadioGroup
            label={t('patient.sex')}
            required
            orientation="horizontal"
            name={field.name}
            value={field.value ?? ''}
            onChange={field.onChange}
            options={SEXES.map((sex) => ({ value: sex, label: t(`sex.${sex}`) }))}
            error={errorOf('patient.sex', fieldState.error)}
          />
        )}
      />
      <Controller
        control={control}
        name="patient.birthDate"
        render={({ field, fieldState }) => (
          <DatePicker
            label={t('patient.birthDate')}
            name={field.name}
            value={typeof field.value === 'string' ? field.value : ''}
            onChange={field.onChange}
            max={todayIso()}
            labels={{
              open: t('calendar.open'),
              previousMonth: t('calendar.previousMonth'),
              nextMonth: t('calendar.nextMonth'),
              today: t('calendar.today'),
            }}
            invalidMessage={errorOf('patient.birthDate', { type: 'format' })}
            error={errorOf('patient.birthDate', fieldState.error)}
          />
        )}
      />
      <Controller
        control={control}
        name="patient.birthDateIsEstimate"
        render={({ field }) => (
          <Checkbox
            label={t('patient.birthDateEstimated')}
            name={field.name}
            checked={Boolean(field.value)}
            onChange={(event) => field.onChange(event.target.checked)}
          />
        )}
      />
      <Controller
        control={control}
        name="patient.isNeutered"
        render={({ field }) => (
          <RadioGroup
            label={t('patient.neutered')}
            orientation="horizontal"
            name={field.name}
            value={field.value === undefined ? '' : field.value ? 'yes' : 'no'}
            onChange={(value) => field.onChange(value === 'yes')}
            options={[
              { value: 'yes', label: t('answer.yes') },
              { value: 'no', label: t('answer.no') },
            ]}
          />
        )}
      />
      <TextInput control={control} name="patient.colour" label={t('patient.colour')} errorOf={errorOf} />
      <TextInput
        control={control}
        name="patient.microchipNumber"
        label={t('patient.microchipNumber')}
        inputMode="numeric"
        errorOf={errorOf}
      />
    </FormSection>
  )
}

/**
 * The breed: one of the species' breeds, or one added inline with its name in the screen's language (spec #18), which
 * the species list then carries and the field takes at once.
 */
function BreedField({
  me,
  species,
  control,
  language,
}: {
  me: Me
  species: Species[]
  control: Control<RegistrationInput>
  language: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const speciesId = useWatch({ control, name: 'patient.speciesId' })
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = useMutation({
    mutationFn: async (input: { speciesId: string; name: string }) => {
      const breedId = uuidv7()
      const { data, response } = await api.PUT('/api/p/{practiceId}/breeds/{breedId}', {
        params: { ...practiceParams(me), path: { practiceId: me.practice.id, breedId } },
        body: { speciesId: input.speciesId, language: language as Language, name: input.name },
      })
      if (!data) throw new Error(`breed answered ${response.status}`)
      return data
    },
    onSuccess: (breed) => {
      queryClient.setQueryData(speciesQuery(me).queryKey, (current) =>
        current
          ? {
              species: current.species.map((item) =>
                item.id === breed.speciesId && !item.breeds.some((known) => known.id === breed.id)
                  ? { ...item, breeds: [...item.breeds, { id: breed.id, name: breed.name }] }
                  : item,
              ),
            }
          : current,
      )
      setAdding(false)
      setName('')
    },
  })
  const breeds = species.find((item) => item.id === speciesId)?.breeds ?? []

  return (
    <Controller
      control={control}
      name="patient.breedId"
      render={({ field }) => {
        if (adding) {
          const submit = () => {
            if (!speciesId || name.trim() === '') return
            add.mutate({ speciesId, name: name.trim() }, { onSuccess: (breed) => field.onChange(breed.id) })
          }
          return (
            <div>
              <TextField
                label={t('patient.breed')}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  submit()
                }}
                error={add.isError ? t('error.save.title') : undefined}
              />
              <Button size="sm" loading={add.isPending} onClick={submit}>
                {t('action.add')}
              </Button>
            </div>
          )
        }
        return (
          <div>
            <Combobox
              label={t('patient.breed')}
              options={breeds
                .map((breed) => ({ value: breed.id, label: nameIn(breed.name, language) }))
                .sort((a, b) => compareText(a.label, b.label, language))}
              value={typeof field.value === 'string' ? field.value : null}
              onChange={(value) => field.onChange(value)}
              emptyText={t('empty.search.title')}
              clearLabel={t('action.clear')}
              disabled={!speciesId}
            />
            <Button variant="ghost" size="sm" icon="add" disabled={!speciesId} onClick={() => setAdding(true)}>
              {t('patient.addBreed')}
            </Button>
          </div>
        )
      }}
    />
  )
}

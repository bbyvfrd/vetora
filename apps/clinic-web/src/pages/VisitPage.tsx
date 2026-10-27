import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  actionOfReading,
  can,
  type Me,
  NewObservation,
  type VisitNote as Note,
  type Observation,
  VITAL_SIGNS,
  type Visit,
  type VitalKind,
  versionTag,
} from '@vetora/contracts'
import {
  Banner,
  Button,
  Dialog,
  formatAge,
  formatDate,
  formatNumber,
  formatPhone,
  type NoteSection,
  PageBody,
  PageHeader,
  type PatientFact,
  PatientHeader,
  parseNumber,
  Skeleton,
  toast,
  VisitNote,
  type VitalField,
} from '@vetora/ui'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { lastWeightQuery, observationsQuery } from '../api/observations'
import { practiceParams } from '../api/practice'
import { visitsTodayQuery } from '../api/visits'
import { uuidv7 } from '../ids'
import { fullName, nameIn } from '../names'
import { meQuery } from '../session'
import { practiceToday, wallClock } from '../time'

/**
 * The visit page (#22; spec #18, "Web app" and "Visit and money behaviour"; stories 36, 38, 43 to 46, 50 to 55), as the
 * design system's VisitPage example lays it out: the patient header (name, species, breed, sex, age, the owner and
 * their phone) with Complete visit as its primary action and Cancel visit beside it while the visit is a draft and the
 * person a vet, then the note's six sections in the order the vet works. The note saves when the person leaves a
 * section or the page, against the version it was read at, and its save line says saving, saved or not saved (a 412
 * too, until the conflict that keeps the text arrives with #24). Complete visit needs the reason for visit: without it
 * the field says so and takes the focus, and nothing typed is lost. Once completed the note is read only. Above the
 * sections, the vital signs (#23; stories 39 to 42): each reading saved when its field is left, a new reading for each
 * new value, the last weight and its date under the weight; a receptionist records the weight and reads the rest. The
 * invoice arrives with #25.
 */

/** The six sections, in the order the vet works (docs/domain.md §7.1). */
const SECTIONS = ['reasonForVisit', 'anamnesis', 'examination', 'diagnosis', 'treatment', 'recommendations'] as const

/** The vital signs in the design system's order (its VisitPage example; the artifact decides it, ADR 0005). */
const VITALS = ['temperature', 'pulse', 'respiratory_rate', 'weight'] as const satisfies readonly VitalKind[]

/**
 * Each vital sign's words: its label (the glossary), its unit as the glossary's Units write it in the interface
 * language (the stored one is the contracts' `VITAL_SIGNS`), and what its field says when the value cannot be a
 * reading (messages.md, Field errors).
 */
const VITAL_WORDS = {
  temperature: { label: 'visit.vital.temperature', unit: 'unit.celsius', error: 'field.temperature' },
  pulse: { label: 'visit.vital.pulse', unit: 'unit.perMinute', error: 'field.pulse' },
  respiratory_rate: { label: 'visit.vital.respiratoryRate', unit: 'unit.perMinute', error: 'field.respiratoryRate' },
  weight: { label: 'visit.vital.weight', unit: 'unit.kg', error: 'field.weight' },
} as const satisfies Record<VitalKind, { label: string; unit: string; error: string }>

/** Between a number and its unit, so the two never part at a line end (formats.md, Units). */
const NBSP = ' '

const visitQuery = (me: Me, visitId: string) =>
  queryOptions({
    queryKey: ['visit', me.practice.id, visitId] as const,
    queryFn: async (): Promise<Visit> => {
      const { data, response } = await api.GET('/api/p/{practiceId}/visits/{visitId}', {
        params: { ...practiceParams(me), path: { practiceId: me.practice.id, visitId } },
      })
      if (!data) throw new Error(`visit answered ${response.status}`)
      return data
    },
  })

export function VisitPage({ visitId }: { visitId: string }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { data: me } = useSuspenseQuery(meQuery)
  const visit = useQuery(visitQuery(me, visitId))
  const observations = useQuery(observationsQuery(me, visitId))
  const back = {
    label: t('visitsToday.title'),
    href: '/',
    onClick: (event: MouseEvent) => {
      event.preventDefault()
      void navigate({ to: '/' })
    },
  }

  if (!visit.data || !observations.data) {
    return (
      <>
        <PageHeader title={t('visit.note')} back={back} />
        <PageBody>
          <section aria-label={t('visit.note')} aria-busy={visit.isPending || observations.isPending || undefined}>
            {visit.isError || observations.isError ? (
              <Banner
                status="danger"
                title={t('error.load.title')}
                action={{
                  label: t('error.load.button'),
                  onClick: () => {
                    if (visit.isError) void visit.refetch()
                    if (observations.isError) void observations.refetch()
                  },
                }}
              >
                {t('error.load.body')}
              </Banner>
            ) : (
              <Skeleton variant="block" lines={4} />
            )}
          </section>
        </PageBody>
      </>
    )
  }
  // A new note for each status the visit reaches: a completed one starts read only from the server's text.
  return (
    <VisitWork
      key={`${visit.data.id}:${visit.data.status}`}
      me={me}
      visit={visit.data}
      observations={observations.data}
      back={back}
    />
  )
}

const sameNote = (a: Note, b: Note) => SECTIONS.every((id) => a[id] === b[id])

type SaveState = 'saving' | 'saved' | 'error'

/**
 * The draft note on the page and its saving: the text as typed, what the server holds and at which version, and the
 * save line. One save at a time; a save asked for while one is under way waits for it and then sends what is newer.
 */
function useNote(me: Me, visit: Visit) {
  const [values, setValues] = useState<Note>(visit.note)
  const [saveState, setSaveState] = useState<SaveState>()
  const typed = useRef(visit.note)
  const server = useRef({ note: visit.note, version: visit.version })
  const pending = useRef<Promise<boolean> | null>(null)
  /** Set once the visit is cancelled: nothing more is saved into it. */
  const closed = useRef(false)

  const change = (id: (typeof SECTIONS)[number], value: string) => {
    typed.current = { ...typed.current, [id]: value }
    setValues(typed.current)
  }

  /** The practice path, the location and the version the server holds, for a change to the visit. */
  const changeParams = () => ({
    path: { practiceId: me.practice.id, visitId: visit.id },
    header: { ...practiceParams(me).header, 'if-match': versionTag(server.current.version) },
  })

  async function send(note: Note): Promise<boolean> {
    setSaveState('saving')
    try {
      const { data } = await api.PUT('/api/p/{practiceId}/visits/{visitId}/note', {
        params: changeParams(),
        body: note,
      })
      if (!data) throw new Error('the note was not saved')
      server.current = { note, version: data.version }
      setSaveState('saved')
      return true
    } catch {
      setSaveState('error')
      return false
    }
  }

  /** Save what was typed when it differs from the server's; whether the server holds it afterwards. */
  async function save(): Promise<boolean> {
    while (pending.current) await pending.current
    if (closed.current || sameNote(typed.current, server.current.note)) return true
    const sending = send(typed.current)
    pending.current = sending
    try {
      return await sending
    } finally {
      pending.current = null
    }
  }

  // Leaving the page saves what is still unsaved.
  // biome-ignore lint/correctness/useExhaustiveDependencies: save reads refs only, so the first one stays current
  useEffect(() => () => void save(), [])

  return { values, change, save, saveState, changeParams, close: () => (closed.current = true) }
}

type VitalValues = Record<VitalKind, string>

/** The value typed as a reading of its kind, or null when it is no number, outside the plausible range or too fine. */
function readingOf(kind: VitalKind, text: string): number | null {
  const value = parseNumber(text)
  if (value === null) return null
  return NewObservation.safeParse({ kind, value, unit: VITAL_SIGNS[kind].unit }).success ? value : null
}

/**
 * The vital signs on the page and their saving (#23): each field as typed, starting from the visit's newest reading of
 * its kind; which ones say what to enter; and the readings sent one at a time, in the order the fields were left, so
 * the newest reading is the last value typed. Leaving a field with a new plausible value records a new reading (PT-2:
 * a correction is a new row); a reading that failed is sent again with the same id when the same value is left again.
 */
function useVitalSigns(me: Me, visit: Visit, observations: Observation[]) {
  const queryClient = useQueryClient()
  const newest = (kind: VitalKind) => observations.findLast((reading) => reading.kind === kind)
  const typed = useRef(
    Object.fromEntries(
      VITALS.map((kind) => {
        const reading = newest(kind)
        return [kind, reading ? formatNumber(reading.value) : '']
      }),
    ) as VitalValues,
  )
  const [values, setValues] = useState(typed.current)
  const [invalid, setInvalid] = useState<Partial<Record<VitalKind, boolean>>>({})
  const [saveState, setSaveState] = useState<SaveState>()
  /** Each kind's newest reading as it will stand once the readings queued are sent: what a new value is compared with. */
  const latest = useRef<Partial<Record<VitalKind, number>>>(
    Object.fromEntries(VITALS.map((kind) => [kind, newest(kind)?.value])),
  )
  /** A reading queued or refused and not yet on the server, by kind: its value and the id a retry reuses. */
  const unsaved = useRef<Partial<Record<VitalKind, { value: number; id: string }>>>({})
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  const change = (kind: VitalKind, text: string) => {
    typed.current = { ...typed.current, [kind]: text }
    setValues(typed.current)
    setInvalid((marked) => ({ ...marked, [kind]: false }))
  }

  async function send(kind: VitalKind, value: number, id: string) {
    setSaveState('saving')
    try {
      const { data } = await api.PUT('/api/p/{practiceId}/visits/{visitId}/observations/{observationId}', {
        params: { ...practiceParams(me), path: { practiceId: me.practice.id, visitId: visit.id, observationId: id } },
        body: { kind, value, unit: VITAL_SIGNS[kind].unit },
      })
      if (!data) throw new Error('the reading was not saved')
      // A newer value queued after this one stays unsaved until it is sent itself.
      if (unsaved.current[kind]?.id === id) unsaved.current[kind] = undefined
      setSaveState('saved')
      void queryClient.invalidateQueries({ queryKey: observationsQuery(me, visit.id).queryKey })
    } catch {
      setSaveState('error')
    }
  }

  /** Leaving a field: nothing typed sends nothing, an implausible value says what to enter, a new value is a reading. */
  const leave = (kind: VitalKind) => {
    const text = typed.current[kind].trim()
    if (text === '') return
    const value = readingOf(kind, text)
    if (value === null) {
      setInvalid((marked) => ({ ...marked, [kind]: true }))
      return
    }
    const pending = unsaved.current[kind]
    if (value === latest.current[kind] && !pending) return
    const id = pending?.value === value ? pending.id : uuidv7()
    latest.current[kind] = value
    unsaved.current[kind] = { value, id }
    queue.current = queue.current.then(() => send(kind, value, id))
  }

  /** Whether every reading left in a field has reached the server, once those under way are done. */
  async function settled(): Promise<boolean> {
    await queue.current
    return VITALS.every((kind) => unsaved.current[kind] === undefined)
  }

  return { values, invalid, change, leave, settled, saveState }
}

/** One save line for the note and its readings: saving while either saves, not saved while either failed. */
function combinedSaveState(a: SaveState | undefined, b: SaveState | undefined): SaveState | undefined {
  if (a === 'saving' || b === 'saving') return 'saving'
  if (a === 'error' || b === 'error') return 'error'
  return a ?? b
}

type VisitWorkProps = {
  me: Me
  visit: Visit
  observations: Observation[]
  back: { label: string; href: string; onClick: (event: MouseEvent) => void }
}

function VisitWork({ me, visit, observations, back }: VisitWorkProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const zone = me.practice.timeZone
  const draft = visit.status === 'draft'
  const writes = draft && can(me.practice.roles, 'recordVitalSignsAndNote')
  const conducts = draft && can(me.practice.roles, 'conductEncounter')
  const records = (kind: VitalKind) => draft && can(me.practice.roles, actionOfReading(kind))
  const note = useNote(me, visit)
  const vitals = useVitalSigns(me, visit, observations)
  const lastWeight = useQuery(lastWeightQuery(me, visit.patient.id, visit.id))
  const noteRef = useRef<HTMLDivElement>(null)
  const [reasonMissing, setReasonMissing] = useState(false)
  // Each refused Complete visit asks for the focus again, even when the message already shows.
  const [focusAsked, setFocusAsked] = useState(0)
  const [asking, setAsking] = useState(false)

  useEffect(() => {
    if (focusAsked > 0) noteRef.current?.querySelector<HTMLTextAreaElement>('textarea[aria-invalid="true"]')?.focus()
  }, [focusAsked])

  const reasonBlocked = () => {
    setReasonMissing(true)
    setFocusAsked((count) => count + 1)
  }
  const refreshLists = () => queryClient.invalidateQueries({ queryKey: visitsTodayQuery(me).queryKey })

  const complete = useMutation({
    mutationFn: async (): Promise<'completed' | 'reason-missing'> => {
      // A reading left in a field as Complete visit is pressed is sent first: the completion would refuse it.
      const [noteSaved, readingsSaved] = await Promise.all([note.save(), vitals.settled()])
      if (!noteSaved || !readingsSaved) throw new Error('the note was not saved')
      const { data, error, response } = await api.POST('/api/p/{practiceId}/visits/{visitId}/complete', {
        params: note.changeParams(),
      })
      if (data) return 'completed'
      if ((error as { code?: string } | undefined)?.code === 'vetora.reason_for_visit_required') return 'reason-missing'
      throw new Error(`complete answered ${response.status}`)
    },
    onSuccess: async (outcome) => {
      if (outcome === 'reason-missing') return reasonBlocked()
      toast({ title: t('toast.visit.completed'), status: 'success' })
      void refreshLists()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: observationsQuery(me, visit.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: visitQuery(me, visit.id).queryKey }),
      ])
    },
  })

  const cancel = useMutation({
    mutationFn: async () => {
      const { data, response } = await api.POST('/api/p/{practiceId}/visits/{visitId}/cancel', {
        params: note.changeParams(),
      })
      if (!data) throw new Error(`cancel answered ${response.status}`)
    },
    onSuccess: () => {
      note.close()
      toast({ title: t('toast.visit.cancelled'), status: 'success' })
      void refreshLists()
      void navigate({ to: '/' })
    },
    onSettled: () => setAsking(false),
  })

  const onComplete = () => {
    if (note.values.reasonForVisit.trim() === '') return reasonBlocked()
    complete.mutate()
  }

  const { patient, owner } = visit
  const neutered = patient.isNeutered ? `, ${t(`visit.neutered.${patient.sex}`)}` : ''
  const facts: PatientFact[] = [
    { label: t('patient.species'), value: nameIn(patient.species, i18n.language) },
    ...(patient.breed ? [{ label: t('patient.breed'), value: nameIn(patient.breed, i18n.language) }] : []),
    {
      label: t('patient.sex'),
      value: `${t(`sex.${patient.sex}`)}${neutered}`,
      icon: patient.sex === 'unknown' ? undefined : patient.sex,
    },
    ...(patient.birthDate
      ? [{ label: t('visit.age'), value: formatAge(patient.birthDate, { on: practiceToday(zone) }) }]
      : []),
  ]
  const sections: NoteSection[] = SECTIONS.map((id) => ({
    id,
    label: t(`visit.section.${id}`),
    required: id === 'reasonForVisit',
    rows: id === 'examination' ? 3 : undefined,
    error: id === 'reasonForVisit' && reasonMissing ? t('field.reasonForVisit') : undefined,
  }))
  /** A weight as formats.md writes it: kilograms to one decimal, grams under one kilogram. */
  const weightParts = (kg: number) =>
    kg < 1
      ? { value: formatNumber(Math.round(kg * 1000)), unit: t('unit.g') }
      : { value: formatNumber(kg, { decimals: 1 }), unit: t('unit.kg') }
  const weightText = (kg: number) => {
    const { value, unit } = weightParts(kg)
    return `${value}${NBSP}${unit}`
  }
  // The note as text (completed, or a person who records nothing): the weight is written, not shown as typed.
  const noteAsText = !writes && !VITALS.some(records)
  const weightRead = noteAsText ? observations.findLast((reading) => reading.kind === 'weight') : undefined
  const weighed = lastWeight.data
  const vitalFields: VitalField[] = VITALS.map((kind) => ({
    id: kind,
    label: t(VITAL_WORDS[kind].label),
    unit: t(VITAL_WORDS[kind].unit),
    value: vitals.values[kind],
    ...(kind === 'weight' && weightRead ? weightParts(weightRead.value) : {}),
    previous:
      kind === 'weight' && weighed
        ? t('visit.lastWeight', {
            value: weightText(weighed.value),
            date: formatDate(wallClock(weighed.occurredAt, zone)),
          })
        : undefined,
    error: vitals.invalid[kind] ? t(VITAL_WORDS[kind].error) : undefined,
    readOnly: !records(kind),
  }))
  const saveState = combinedSaveState(note.saveState, vitals.saveState)
  const saveLabel =
    saveState === 'saving'
      ? t('visit.saving')
      : saveState === 'saved'
        ? t('visit.saved')
        : saveState === 'error'
          ? t('visit.notSaved')
          : undefined

  return (
    <>
      <PatientHeader
        name={patient.name}
        facts={facts}
        owner={{
          label: t('visit.owner'),
          name: fullName(owner),
          phone: owner.phone ? formatPhone(owner.phone) : undefined,
        }}
        back={back}
        actions={
          conducts ? (
            <>
              <Button onClick={() => setAsking(true)}>{t('visit.cancel')}</Button>
              <Button variant="primary" icon="check" loading={complete.isPending} onClick={onComplete}>
                {t('visit.complete')}
              </Button>
            </>
          ) : undefined
        }
      />
      <PageBody>
        {complete.isError || cancel.isError ? (
          <Banner status="danger" title={t('error.save.title')}>
            {t('error.save.body')}
          </Banner>
        ) : null}
        {/* Holds the note, so a refused Complete visit can move the focus to the section it names. */}
        <div ref={noteRef}>
          <VisitNote
            title={t('visit.note')}
            subtitle={`${formatDate(wallClock(visit.startedAt, zone), { style: 'long' })} · ${visit.veterinarian.displayName}`}
            vitalsLabel={t('visit.vitals')}
            vitals={vitalFields}
            onVitalChange={(id, value) => vitals.change(id as VitalKind, value)}
            onVitalBlur={(id) => vitals.leave(id as VitalKind)}
            sections={sections}
            values={note.values}
            onChange={(id, value) => {
              note.change(id as (typeof SECTIONS)[number], value)
              if (id === 'reasonForVisit' && value.trim() !== '') setReasonMissing(false)
            }}
            onSectionBlur={() => void note.save()}
            readOnly={noteAsText}
            readOnlySections={!writes}
            saveState={saveState}
            saveLabel={saveLabel}
            labels={{ high: t('visit.high'), low: t('visit.low'), empty: t('visit.notRecorded') }}
          />
        </div>
      </PageBody>
      <Dialog
        open={asking}
        size="sm"
        title={t('confirm.visitCancel.title')}
        onClose={() => setAsking(false)}
        closeLabel={t('action.close')}
        footer={
          <>
            <Button onClick={() => setAsking(false)}>{t('confirm.visitCancel.back')}</Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('confirm.visitCancel.button')}
            </Button>
          </>
        }
      >
        <p>{t('confirm.visitCancel.body')}</p>
      </Dialog>
    </>
  )
}

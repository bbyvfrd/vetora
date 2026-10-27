import { queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { can, type Me, type VisitNote as Note, type Visit, versionTag } from '@vetora/contracts'
import {
  Banner,
  Button,
  Dialog,
  formatAge,
  formatDate,
  formatPhone,
  type NoteSection,
  PageBody,
  PageHeader,
  type PatientFact,
  PatientHeader,
  Skeleton,
  toast,
  VisitNote,
} from '@vetora/ui'
import { type MouseEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { practiceParams } from '../api/practice'
import { visitsTodayQuery } from '../api/visits'
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
 * the field says so and takes the focus, and nothing typed is lost. Once completed the note is read only. The vital
 * signs arrive with #23, the invoice with #25.
 */

/** The six sections, in the order the vet works (docs/domain.md §7.1). */
const SECTIONS = ['reasonForVisit', 'anamnesis', 'examination', 'diagnosis', 'treatment', 'recommendations'] as const

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
  const back = {
    label: t('visitsToday.title'),
    href: '/',
    onClick: (event: MouseEvent) => {
      event.preventDefault()
      void navigate({ to: '/' })
    },
  }

  if (!visit.data) {
    return (
      <>
        <PageHeader title={t('visit.note')} back={back} />
        <PageBody>
          <section aria-label={t('visit.note')} aria-busy={visit.isPending || undefined}>
            {visit.isError ? (
              <Banner
                status="danger"
                title={t('error.load.title')}
                action={{ label: t('error.load.button'), onClick: () => void visit.refetch() }}
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
  return <VisitWork key={`${visit.data.id}:${visit.data.status}`} me={me} visit={visit.data} back={back} />
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

type VisitWorkProps = {
  me: Me
  visit: Visit
  back: { label: string; href: string; onClick: (event: MouseEvent) => void }
}

function VisitWork({ me, visit, back }: VisitWorkProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const zone = me.practice.timeZone
  const draft = visit.status === 'draft'
  const writes = draft && can(me.practice.roles, 'recordVitalSignsAndNote')
  const conducts = draft && can(me.practice.roles, 'conductEncounter')
  const note = useNote(me, visit)
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
      if (!(await note.save())) throw new Error('the note was not saved')
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
      await queryClient.invalidateQueries({ queryKey: visitQuery(me, visit.id).queryKey })
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
  const saveLabel =
    note.saveState === 'saving'
      ? t('visit.saving')
      : note.saveState === 'saved'
        ? t('visit.saved')
        : note.saveState === 'error'
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
            sections={sections}
            values={note.values}
            onChange={(id, value) => {
              note.change(id as (typeof SECTIONS)[number], value)
              if (id === 'reasonForVisit' && value.trim() !== '') setReasonMissing(false)
            }}
            onSectionBlur={() => void note.save()}
            readOnly={!writes}
            saveState={note.saveState}
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

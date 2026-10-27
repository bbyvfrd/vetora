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
import { forgetDraft, keepDraft, keptDraft } from '../drafts'
import { fullName, nameIn } from '../names'
import { meQuery } from '../session'
import { practiceToday, wallClock } from '../time'

/**
 * The visit page (#22; spec #18, "Web app" and "Visit and money behaviour"; stories 36, 38, 43 to 46, 50 to 55), as the
 * design system's VisitPage example lays it out: the patient header (name, species, breed, sex, age, the owner and
 * their phone) with Complete visit as its primary action and Cancel visit beside it while the visit is a draft and the
 * person a vet, then the note's six sections in the order the vet works. Complete visit needs the reason for visit:
 * without it the field says so and takes the focus, and nothing typed is lost. Once completed the note is read only.
 * The vital signs arrive with #23, the invoice with #25.
 *
 * The draft note survives a dropped connection (#24; stories 10, 46 to 49): what is typed is kept on this computer
 * (`src/drafts.ts`) and saved to the server against the version it was read at, on the rhythm `useNote` describes. A
 * save a colleague's beat is refused with 412: the text stays, the page says so, and loading the latest version puts
 * the colleague's text in the note with the vet's own offered beside it. Opening a visit whose kept text differs from
 * the server's offers it back the same way; the note waits until it is restored or discarded.
 */

/** The six sections, in the order the vet works (docs/domain.md §7.1). */
const SECTIONS = ['reasonForVisit', 'anamnesis', 'examination', 'diagnosis', 'treatment', 'recommendations'] as const

/** How long the text is still before it is saved. */
const stillFor = 3_000
/** The least time between two saves of the note (spec 0002 keeps the audit table small; the copy holds the rest). */
const saveEvery = 30_000
/** How long typing pauses before the text is kept on this computer. */
const keepAfter = 1_000

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
  const kept = useKeptNote(me.id, visit.data)
  const back = {
    label: t('visitsToday.title'),
    href: '/',
    onClick: (event: MouseEvent) => {
      event.preventDefault()
      void navigate({ to: '/' })
    },
  }

  if (!visit.data || kept === undefined) {
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
  return <VisitWork key={`${visit.data.id}:${visit.data.status}`} me={me} visit={visit.data} kept={kept} back={back} />
}

const sameNote = (a: Note, b: Note) => SECTIONS.every((id) => a[id] === b[id])

/**
 * The text this person kept on this computer for the visit, looked up once the visit has loaded: `null` when there is
 * none to offer, `undefined` until then. A copy equal to the server's note is deleted without a word.
 */
function useKeptNote(personId: string, visit: Visit | undefined): Note | null | undefined {
  const [found, setFound] = useState<{ visitId: string; note: Note | null }>()
  const visitId = visit?.id
  // The visit as it first loaded; a later refetch of the same visit asks nothing again.
  const firstLoad = useRef<Visit>(undefined)
  if (visit && firstLoad.current?.id !== visit.id) firstLoad.current = visit

  useEffect(() => {
    if (!visitId) return
    let current = true
    void (async () => {
      const copy = await keptDraft(personId, visitId)
      let note = copy?.note ?? null
      const saved = firstLoad.current?.id === visitId ? firstLoad.current.note : undefined
      if (note && saved && sameNote(note, saved)) {
        await forgetDraft(personId, visitId)
        note = null
      }
      if (current) setFound({ visitId, note })
    })()
    return () => {
      current = false
    }
  }, [personId, visitId])

  return found && found.visitId === visitId ? found.note : undefined
}

/** Whether what is typed has reached the server: on its way, there, kept here for want of a connection, or refused. */
type SaveState = 'saving' | 'saved' | 'offline' | 'error'

/** How one save ended. */
type Outcome = 'saved' | 'offline' | 'conflict' | 'refused'

/**
 * Where the note stands: written and saved; refused as stale (a colleague saved first), so kept here but not saved; or
 * kept text on offer beside it, so neither until Restore or Discard.
 */
type Phase = 'writing' | 'conflict' | 'offer'

/**
 * The draft note on the page, its copy on this computer and its saving (#24; spec #18, "Visit and money behaviour").
 * The copy is written a second after typing pauses, and when the person leaves a section, the tab or the page. The
 * server save runs once the text has been still three seconds, or 30 seconds after the first unsaved change of a vet
 * who types on, but never within 30 seconds of the last one; leaving a section asks for it at once on the same terms.
 * Leaving the page, Complete visit and Restore save at once. A save that finds no connection says so and is tried again
 * when the browser is back online and every 30 seconds. One save at a time; a save asked for while one is under way
 * waits for it and then sends what is newer.
 */
function useNote(me: Me, visit: Visit, initiallyKept: Note | null) {
  const queryClient = useQueryClient()
  const [values, setValues] = useState<Note>(visit.note)
  const [saveState, setSaveState] = useState<SaveState>()
  const [kept, setKept] = useState<Note | null>(initiallyKept)
  const [phase, setPhaseState] = useState<Phase>(initiallyKept ? 'offer' : 'writing')
  const phaseNow = useRef(phase)
  const typed = useRef(visit.note)
  const server = useRef({ note: visit.note, version: visit.version })
  const pending = useRef<Promise<Outcome> | null>(null)
  const lastOutcome = useRef<Outcome>(undefined)
  /** When the last save was sent, and when the first change it does not carry was made. */
  const lastSent = useRef(Number.NEGATIVE_INFINITY)
  const unsavedSince = useRef<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const keepTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  /** Set once the visit is cancelled: nothing more is saved or kept. */
  const closed = useRef(false)
  /** Set once the page is left: nothing more is asked for later. */
  const left = useRef(false)

  const setPhase = (next: Phase) => {
    phaseNow.current = next
    setPhaseState(next)
  }
  /** Put `note` in the editor as the text typed. */
  const show = (note: Note) => {
    typed.current = note
    setValues(note)
  }

  /** The practice path, the location and the version the server holds, for a change to the visit. */
  const changeParams = () => ({
    path: { practiceId: me.practice.id, visitId: visit.id },
    header: { ...practiceParams(me).header, 'if-match': versionTag(server.current.version) },
  })

  /** Keep what is typed on this computer, or delete the copy once the server holds the same text. */
  function keepNow() {
    clearTimeout(keepTimer.current)
    if (closed.current || phaseNow.current === 'offer') return
    const note = typed.current
    const { note: saved, version } = server.current
    void (sameNote(note, saved)
      ? forgetDraft(me.id, visit.id)
      : keepDraft({ personId: me.id, visitId: visit.id, note, baseVersion: version, keptAt: new Date().toISOString() }))
  }

  /** Ask for a save once the text has been still `still` ms, or 30 s after the first unsaved change, never within 30 s of the last save. */
  function plan(still: number) {
    clearTimeout(saveTimer.current)
    if (left.current || phaseNow.current !== 'writing') return
    const now = Date.now()
    const due = Math.max(Math.min(now + still, (unsavedSince.current ?? now) + saveEvery), lastSent.current + saveEvery)
    saveTimer.current = setTimeout(() => void save(), due - now)
  }

  const change = (id: (typeof SECTIONS)[number], value: string) => {
    show({ ...typed.current, [id]: value })
    unsavedSince.current ??= Date.now()
    clearTimeout(keepTimer.current)
    keepTimer.current = setTimeout(keepNow, keepAfter)
    // The browser knows the connection is gone before a save finds out: the line says so as the vet types.
    if (!navigator.onLine && phaseNow.current === 'writing') setSaveState('offline')
    plan(stillFor)
  }

  /** Leaving a section: the text is still. */
  const settle = () => {
    keepNow()
    plan(0)
  }

  async function put(note: Note, leaving: boolean): Promise<Outcome> {
    try {
      const { data, response } = await api.PUT('/api/p/{practiceId}/visits/{visitId}/note', {
        params: changeParams(),
        body: note,
        // A save sent as the tab closes outlives it.
        keepalive: leaving,
      })
      if (response.status === 412) return 'conflict'
      // A gateway that cannot reach the API is no connection too: kept here and tried again.
      if (response.status >= 502 && response.status <= 504) return 'offline'
      if (!data) return 'refused'
      server.current = { note, version: data.version }
      return 'saved'
    } catch {
      return 'offline'
    }
  }

  async function send(note: Note, leaving: boolean): Promise<Outcome> {
    const since = unsavedSince.current
    lastSent.current = Date.now()
    unsavedSince.current = null
    setSaveState('saving')
    const outcome = await put(note, leaving)
    lastOutcome.current = outcome
    if (outcome !== 'saved') unsavedSince.current = since ?? unsavedSince.current
    if (outcome === 'saved') {
      setSaveState('saved')
      keepNow()
    } else if (outcome === 'conflict') {
      setSaveState('error')
      setPhase('conflict')
      keepNow()
    } else if (outcome === 'offline') {
      setSaveState('offline')
      plan(0)
    } else {
      setSaveState('error')
    }
    return outcome
  }

  /** Save what was typed when it differs from the server's; whether the server holds it afterwards. */
  async function save({ leaving = false } = {}): Promise<boolean> {
    clearTimeout(saveTimer.current)
    while (pending.current) await pending.current
    if (closed.current) return true
    if (phaseNow.current !== 'writing') return false
    if (sameNote(typed.current, server.current.note)) return true
    const sending = send(typed.current, leaving)
    pending.current = sending
    try {
      return (await sending) === 'saved'
    } finally {
      pending.current = null
    }
  }

  /** After a 412: the colleague's text becomes the note, and the vet's own is offered beside it. */
  async function loadLatest() {
    keepNow()
    let latest: Visit
    try {
      latest = await queryClient.fetchQuery({ ...visitQuery(me, visit.id), staleTime: 0 })
    } catch {
      return
    }
    setKept(typed.current)
    server.current = { note: latest.note, version: latest.version }
    show(latest.note)
    setSaveState(undefined)
    setPhase('offer')
  }

  /** The kept text becomes the note and is saved over what the server holds, knowingly. */
  function restore() {
    if (!kept) return
    show(kept)
    setKept(null)
    setPhase('writing')
    unsavedSince.current = Date.now()
    keepNow()
    void save()
  }

  /** The kept text is dropped and the note stays as the server holds it. */
  function discard() {
    setKept(null)
    setPhase('writing')
    void forgetDraft(me.id, visit.id)
  }

  // Leaving the tab keeps the text and saves it; hiding it keeps the text. The connection's loss says so when text is
  // waiting, and its return sends what waited: at once after a save that found no connection (it reached nothing),
  // otherwise on the usual terms.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the handlers read refs only, so the first ones stay current
  useEffect(() => {
    left.current = false
    const leave = () => {
      keepNow()
      void save({ leaving: true })
    }
    const hidden = () => {
      if (document.visibilityState === 'hidden') keepNow()
    }
    const offline = () => {
      if (phaseNow.current === 'writing' && !sameNote(typed.current, server.current.note)) setSaveState('offline')
    }
    const online = () => {
      if (lastOutcome.current === 'offline') return void save()
      // Only the browser said the connection was gone: the line says again what the last save did.
      const before = lastOutcome.current === 'saved' ? 'saved' : lastOutcome.current ? 'error' : undefined
      setSaveState((state) => (state === 'offline' ? before : state))
      plan(0)
    }
    window.addEventListener('pagehide', leave)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('pagehide', leave)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
      // Leaving the page keeps and saves what is still unsaved, and asks for nothing later.
      left.current = true
      leave()
    }
  }, [])

  return {
    values,
    change,
    settle,
    save,
    saveState,
    phase,
    kept,
    loadLatest,
    restore,
    discard,
    /** Whether saving waits on the person: a conflict, or kept text on offer. */
    stopped: () => phaseNow.current !== 'writing',
    changeParams,
    close: () => {
      closed.current = true
      void forgetDraft(me.id, visit.id)
    },
  }
}

type VisitWorkProps = {
  me: Me
  visit: Visit
  kept: Note | null
  back: { label: string; href: string; onClick: (event: MouseEvent) => void }
}

function VisitWork({ me, visit, kept, back }: VisitWorkProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const zone = me.practice.timeZone
  const draft = visit.status === 'draft'
  const writes = draft && can(me.practice.roles, 'recordVitalSignsAndNote')
  const conducts = draft && can(me.practice.roles, 'conductEncounter')
  // Kept text is offered only to someone who can write it into the note.
  const note = useNote(me, visit, writes ? kept : null)
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
    mutationFn: async (): Promise<'completed' | 'reason-missing' | 'stopped'> => {
      if (!(await note.save())) {
        // A conflict found by this save says so in its own banner.
        if (note.stopped()) return 'stopped'
        throw new Error('the note was not saved')
      }
      const { data, error, response } = await api.POST('/api/p/{practiceId}/visits/{visitId}/complete', {
        params: note.changeParams(),
      })
      if (data) return 'completed'
      if ((error as { code?: string } | undefined)?.code === 'vetora.reason_for_visit_required') return 'reason-missing'
      throw new Error(`complete answered ${response.status}`)
    },
    onSuccess: async (outcome) => {
      if (outcome === 'stopped') return
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
  const labels = { high: t('visit.high'), low: t('visit.low'), empty: t('visit.notRecorded') }
  const saveLine = {
    saving: { state: 'saving', label: t('visit.saving') },
    saved: { state: 'saved', label: t('visit.saved') },
    // Calm, not an error: nothing is lost, and the save goes through when the connection returns.
    offline: { state: 'unsaved', label: t('visit.offline') },
    error: { state: 'error', label: t('visit.notSaved') },
  } as const
  const line = note.saveState ? saveLine[note.saveState] : undefined

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
              <Button
                variant="primary"
                icon="check"
                loading={complete.isPending}
                // The note waits on the vet's choice first: the conflict, or the kept text.
                disabled={note.phase !== 'writing'}
                onClick={onComplete}
              >
                {t('visit.complete')}
              </Button>
            </>
          ) : undefined
        }
      />
      <PageBody>
        {complete.isError && note.saveState === 'offline' ? (
          <Banner status="danger" title={t('error.offline.title')}>
            {t('error.offline.body')}
          </Banner>
        ) : complete.isError || cancel.isError ? (
          <Banner status="danger" title={t('error.save.title')}>
            {t('error.save.body')}
          </Banner>
        ) : null}
        {note.phase === 'conflict' ? (
          <Banner
            status="danger"
            title={t('error.noteConflict.title')}
            action={{ label: t('error.noteConflict.button'), onClick: () => void note.loadLatest() }}
          >
            {t('error.noteConflict.body')}
          </Banner>
        ) : null}
        {note.kept ? (
          <VisitNote
            title={t('notice.noteKept.title')}
            subtitle={t('notice.noteKept.body')}
            sections={sections}
            values={note.kept}
            readOnly
            labels={labels}
            footer={
              <>
                <Button onClick={note.discard}>{t('action.discard')}</Button>
                <Button variant="primary" onClick={note.restore}>
                  {t('action.restore')}
                </Button>
              </>
            }
          />
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
            onSectionBlur={note.settle}
            readOnly={!writes || note.phase === 'offer'}
            saveState={line?.state}
            saveLabel={line?.label}
            labels={labels}
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

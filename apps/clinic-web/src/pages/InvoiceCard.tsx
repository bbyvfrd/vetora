import { useQuery, useQueryClient } from '@tanstack/react-query'
import { can, type Invoice, type Me, type Visit, versionTag } from '@vetora/contracts'
import {
  Banner,
  Button,
  Card,
  Combobox,
  formatMinorUnits,
  type InvoiceLine,
  InvoiceTable,
  type InvoiceTotal,
  Skeleton,
  toast,
} from '@vetora/ui'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api/client'
import { servicesQuery, visitInvoiceQuery } from '../api/invoices'
import { practiceParams } from '../api/practice'
import { visitsTodayQuery } from '../api/visits'
import { uuidv7 } from '../ids'
import { nameIn } from '../names'

/**
 * The visit page's invoice card (#25; spec #18, "Web app": the invoice card; stories 56 to 61), as the design system's
 * VisitPage example lays it out: a `Combobox` that searches the price list by name in the person's language, then the
 * `InvoiceTable` of the lines, with the quantity editable and each line removable while the invoice is a draft, and
 * Issue invoice as the card's one button. The first service chosen creates the draft with its line; choosing a service
 * already on it raises that line's quantity (the example's rule). Every amount comes from the API in minor units and
 * is shown through the design system's money wrapper (IN-4); the table does no arithmetic and neither does the card.
 * Issued, the card is read only and shows Total and Balance due. Changes go one at a time, each against the version
 * the last one answered, so quick clicks never refuse each other; a change a colleague's beat says so and offers the
 * invoice as it now stands.
 */

type Change = () => Promise<{ data?: Invoice; response: Response }>

export function InvoiceCard({ me, visit }: { me: Me; visit: Visit }) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const invoiceQuery = visitInvoiceQuery(me, visit.id)
  const invoice = useQuery(invoiceQuery)
  const current = invoice.data
  const editable = can(me.practice.roles, 'invoiceAndTakePayment') && current?.status !== 'issued'
  const services = useQuery({ ...servicesQuery(me), enabled: editable })
  // The draft's id, made once, so a retry of its create changes nothing.
  const [draftId] = useState(uuidv7)
  const [problem, setProblem] = useState<'save' | 'conflict'>()
  const [issuing, setIssuing] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  /** The invoice as the last change left it, read when a change is sent, not when it was asked for. */
  const latest = () => queryClient.getQueryData(invoiceQuery.queryKey) ?? null
  const changeParams = (stored: Invoice) => ({
    header: { ...practiceParams(me).header, 'if-match': versionTag(stored.version) },
  })

  /** Send one change after those before it; its answer becomes the card's invoice. Whether it went through. */
  function send(change: Change): Promise<boolean> {
    const sent = queue.current.then(async () => {
      try {
        const { data, response } = await change()
        if (data) {
          queryClient.setQueryData(invoiceQuery.queryKey, data)
          setProblem(undefined)
          return true
        }
        setProblem(response.status === 412 ? 'conflict' : 'save')
      } catch {
        setProblem('save')
      }
      return false
    })
    queue.current = sent
    return sent
  }

  const refreshList = () => queryClient.invalidateQueries({ queryKey: visitsTodayQuery(me).queryKey })

  /**
   * A service chosen in the search: a new line, the draft itself when there is none yet, or one more of a line. The
   * search shows the service while its line is added, then empties for the next one, the focus staying in it.
   */
  const choose = (serviceId: string | null) => {
    if (!serviceId) return
    setChosen(serviceId)
    const added = send(async () => {
      const stored = latest()
      if (!stored) {
        const created = await api.PUT('/api/p/{practiceId}/invoices/{invoiceId}', {
          params: { ...practiceParams(me), path: { practiceId: me.practice.id, invoiceId: draftId } },
          body: {
            visitId: visit.id,
            patientId: visit.patient.id,
            clientId: visit.owner.id,
            line: { id: uuidv7(), serviceId, quantity: 1 },
          },
        })
        void refreshList()
        return created
      }
      const line = stored.lines.find((item) => item.serviceId === serviceId)
      if (line) return putQuantity(stored, line.id, line.quantity + 1)
      return api.PUT('/api/p/{practiceId}/invoices/{invoiceId}/lines/{lineId}', {
        params: {
          ...changeParams(stored),
          path: { practiceId: me.practice.id, invoiceId: stored.id, lineId: uuidv7() },
        },
        body: { serviceId, quantity: 1 },
      })
    })
    void added.then(() => setChosen(null))
  }

  const putQuantity = (stored: Invoice, lineId: string, quantity: number) =>
    api.PUT('/api/p/{practiceId}/invoices/{invoiceId}/lines/{lineId}/quantity', {
      params: { ...changeParams(stored), path: { practiceId: me.practice.id, invoiceId: stored.id, lineId } },
      body: { quantity },
    })

  const setQuantity = (lineId: string, quantity: number) =>
    void send(async () => {
      const stored = latest()
      if (!stored) throw new Error('a line changed on no invoice')
      return putQuantity(stored, lineId, quantity)
    })

  const remove = (lineId: string) =>
    void send(async () => {
      const stored = latest()
      if (!stored) throw new Error('a line removed from no invoice')
      return api.POST('/api/p/{practiceId}/invoices/{invoiceId}/lines/{lineId}/remove', {
        params: { ...changeParams(stored), path: { practiceId: me.practice.id, invoiceId: stored.id, lineId } },
      })
    })

  const issue = async () => {
    setIssuing(true)
    const issued = await send(async () => {
      const stored = latest()
      if (!stored) throw new Error('an invoice issued that is not there')
      return api.POST('/api/p/{practiceId}/invoices/{invoiceId}/issue', {
        params: { ...changeParams(stored), path: { practiceId: me.practice.id, invoiceId: stored.id } },
      })
    })
    setIssuing(false)
    if (!issued) return
    toast({ title: t('toast.invoice.issued'), status: 'success' })
    void refreshList()
  }

  /** After a 412: the invoice as it now stands, and the problem gone. */
  const reload = async () => {
    await invoice.refetch()
    setProblem(undefined)
  }

  if (!invoice.isSuccess) {
    return (
      <Card title={t('invoice.title')}>
        {invoice.isError ? (
          <Banner
            status="danger"
            title={t('error.load.title')}
            action={{ label: t('error.load.button'), onClick: () => void invoice.refetch() }}
          >
            {t('error.load.body')}
          </Banner>
        ) : (
          <Skeleton variant="block" lines={3} />
        )}
      </Card>
    )
  }

  const language = i18n.language
  const issued = current?.status === 'issued'
  const title = issued && current.number ? t('invoice.numbered', { number: current.number }) : t('invoice.title')
  const lines: InvoiceLine[] = (current?.lines ?? []).map((line) => ({
    id: line.id,
    name: nameIn(line.description, language),
    quantity: line.quantity,
    price: line.unitPriceMinor,
    amount: line.totalMinor,
  }))
  const totals: InvoiceTotal[] = current
    ? [
        { id: 'total', label: t('invoice.total'), amount: current.totalMinor, strong: true },
        ...(issued
          ? [{ id: 'balance', label: t('invoice.balanceDue'), amount: current.remainderMinor, strong: true }]
          : []),
      ]
    : []
  // The search covers the three names (the ticket's path): the label is the name in the person's language, and the
  // description, which the Combobox searches too, the price and then the other two names.
  const options = (services.data ?? []).map((service) => {
    const label = nameIn(service.names, language)
    const others = Object.values(service.names).filter((name): name is string => name !== null && name !== label)
    return {
      value: service.id,
      label,
      description: [formatMinorUnits(service.priceMinor, service.currency), ...others].join(' · '),
    }
  })
  const subtitle = current ? t(issued ? 'invoice.status.unpaid' : 'invoice.status.draft') : undefined

  return (
    <Card
      title={title}
      subtitle={subtitle}
      padding="none"
      footer={
        editable && current && current.lines.length > 0 ? (
          <Button loading={issuing} onClick={() => void issue()}>
            {t('invoice.issue')}
          </Button>
        ) : undefined
      }
    >
      {problem === 'conflict' ? (
        <Banner
          status="danger"
          title={t('error.conflict.title')}
          action={{ label: t('error.conflict.button'), onClick: () => void reload() }}
        >
          {t('error.conflict.body')}
        </Banner>
      ) : problem === 'save' ? (
        <Banner status="danger" title={t('error.save.title')}>
          {t('error.save.body')}
        </Banner>
      ) : null}
      {editable ? (
        // Layout glue, as the example pads the search above the table.
        <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
          <Combobox
            label={t('invoice.addService')}
            hideLabel
            icon="add"
            placeholder={t('invoice.addService')}
            emptyText={t('empty.search.title')}
            clearLabel={t('action.clear')}
            options={options}
            value={chosen}
            onChange={choose}
          />
        </div>
      ) : null}
      <InvoiceTable
        caption={title}
        lines={lines}
        totals={totals}
        currency={current?.currency ?? 'AZN'}
        labels={{
          item: t('invoice.column.service'),
          quantity: t('invoice.column.quantity'),
          price: t('invoice.column.price'),
          amount: t('invoice.column.amount'),
          remove: t('invoice.remove'),
        }}
        emptyText={t('empty.invoiceLines.title')}
        onQuantityChange={editable && current ? setQuantity : undefined}
        onRemove={editable && current ? remove : undefined}
      />
    </Card>
  )
}

import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type Invoice, type Me, NewPayment, PaymentMethod, versionTag } from '@vetora/contracts'
import {
  Banner,
  Button,
  Dialog,
  formatMinorUnits,
  formatMinorUnitsPlain,
  parseMinorUnits,
  RadioGroup,
  TextField,
  toast,
} from '@vetora/ui'
import { useId, useState } from 'react'
import { Controller, type FieldError, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { api } from '../api/client'
import { visitInvoiceQuery } from '../api/invoices'
import { practiceParams } from '../api/practice'
import { visitQuery, visitsTodayQuery } from '../api/visits'
import { uuidv7 } from '../ids'

/**
 * The take payment dialog (#26; spec #18, "Web app": the take payment dialog; stories 62 to 66): the amount prefilled
 * with what is still owed on the invoice, typed in manat with up to two decimals and turned into qəpik by the money
 * wrapper (IN-4), cash or card, and Record payment. A smaller amount is a part payment (BL-5); zero, more than is owed,
 * or what is not an amount says what to enter under the field, as the design system's messages write it. The payment's
 * id is made once, when the dialog opens, so a retry changes nothing; it is taken against the invoice's version, and a
 * draft invoice is issued by it. The answer, the invoice as it now stands, takes the card's place; the owner's Balance
 * due and Visits today are asked again.
 */

/** The form's fields: the typed amount read as minor units, then held to the contract's own amount and what is owed. */
const paymentFields = (currency: Invoice['currency'], remainderMinor: number) =>
  z.object({
    amount: z
      .string()
      .transform((text, ctx) => {
        const minor = parseMinorUnits(text, currency)
        if (minor === null) {
          ctx.addIssue({ code: 'custom', message: 'not an amount' })
          return z.NEVER
        }
        return minor
      })
      .pipe(NewPayment.shape.amountMinor.max(remainderMinor)),
    method: PaymentMethod,
  })
type PaymentInput = z.input<ReturnType<typeof paymentFields>>
type PaymentValues = z.output<ReturnType<typeof paymentFields>>

/** How a try ended: the invoice as it now stands, less owed than the amount (another payment came first), or a colleague's change. */
type Outcome = Invoice | 'above-remainder' | 'conflict'

type TakePaymentDialogProps = {
  me: Me
  visitId: string
  /** The visit's invoice, draft or issued: what is still owed is offered, and is the most a payment may be. */
  invoice: Invoice
  onClose: () => void
}

export function TakePaymentDialog({ me, visitId, invoice, onClose }: TakePaymentDialogProps) {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const formId = useId()
  // Made once, when the dialog opens: every try sends the same id (spec 0001, "API conventions": safe retries).
  const [paymentId] = useState(uuidv7)
  const [problem, setProblem] = useState<'save' | 'conflict'>()
  const { currency, remainderMinor } = invoice
  const owed = formatMinorUnits(remainderMinor, currency)
  const invoiceQuery = visitInvoiceQuery(me, visitId)
  const { control, handleSubmit, setError } = useForm<PaymentInput, unknown, PaymentValues>({
    resolver: zodResolver(paymentFields(currency, remainderMinor)),
    mode: 'onTouched',
    defaultValues: { amount: formatMinorUnitsPlain(remainderMinor, currency, i18n.language), method: 'cash' },
  })

  const record = useMutation({
    mutationFn: async ({ amount, method }: PaymentValues): Promise<Outcome> => {
      const { data, error, response } = await api.PUT('/api/p/{practiceId}/invoices/{invoiceId}/payments/{paymentId}', {
        params: {
          header: { ...practiceParams(me).header, 'if-match': versionTag(invoice.version) },
          path: { practiceId: me.practice.id, invoiceId: invoice.id, paymentId },
        },
        body: { amountMinor: amount, method },
      })
      if (data) return data
      if (response.status === 412) return 'conflict'
      // The API's refusal of the amount, or the database's allocation check when two payments met: less is owed.
      const refusal = error as { code?: string; errors?: { path?: unknown[] }[] } | undefined
      if (
        response.status === 409 &&
        (refusal?.code === 'vetora.incomplete_allocation' || refusal?.errors?.[0]?.path?.[0] === 'amountMinor')
      ) {
        return 'above-remainder'
      }
      throw new Error(`take payment answered ${response.status}`)
    },
    onSuccess: async (outcome) => {
      if (outcome === 'conflict') return setProblem('conflict')
      if (outcome === 'above-remainder') {
        // What is owed now, so the field says how much may be taken.
        await queryClient.fetchQuery({ ...invoiceQuery, staleTime: 0 })
        return setError('amount', { type: 'too_big' })
      }
      queryClient.setQueryData(invoiceQuery.queryKey, outcome)
      toast({ title: t('toast.payment.recorded'), status: 'success' })
      void queryClient.invalidateQueries({ queryKey: visitQuery(me, visitId).queryKey })
      void queryClient.invalidateQueries({ queryKey: visitsTodayQuery(me).queryKey })
      onClose()
    },
    onError: () => setProblem('save'),
  })

  /** After a 412: the invoice as it now stands, and the problem gone. */
  const reload = async () => {
    await queryClient.fetchQuery({ ...invoiceQuery, staleTime: 0 })
    setProblem(undefined)
  }

  /** The amount's error in words (messages.md, Field errors): one line that says what to enter. */
  const amountError = (error: FieldError | undefined) => {
    if (!error) return undefined
    if (error.type === 'too_small') return t('field.amountPositive')
    if (error.type === 'too_big') return t('field.amountMax', { amount: owed })
    return t('field.amount')
  }

  return (
    <Dialog
      open
      size="sm"
      title={t('payment.take')}
      onClose={onClose}
      closeLabel={t('action.close')}
      footer={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} loading={record.isPending}>
            {t('payment.record')}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        // Layout glue: the fields stacked with the form section's gap.
        style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
        onSubmit={handleSubmit((values) => {
          setProblem(undefined)
          record.mutate(values)
        })}
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
        <Controller
          control={control}
          name="amount"
          render={({ field, fieldState }) => (
            <TextField
              label={t('payment.amount')}
              required
              inputMode="decimal"
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              hint={t('balance.due', { amount: owed })}
              error={amountError(fieldState.error)}
            />
          )}
        />
        <Controller
          control={control}
          name="method"
          render={({ field }) => (
            <RadioGroup
              label={t('payment.method')}
              orientation="horizontal"
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              options={[
                { value: 'cash', label: t('payment.cash') },
                { value: 'card', label: t('payment.card') },
              ]}
            />
          )}
        />
      </form>
    </Dialog>
  )
}

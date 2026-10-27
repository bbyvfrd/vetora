import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as ui from './index.js'

/**
 * What the artifact's components/src/index.ts exported at the fork point (spec #9, ticket #11), name for name, plus
 * what the repo has added since under ADR 0005: the package's public interface is exactly these lists, nothing hidden
 * and nothing else. A repo addition is listed in docs/design.md's ledger and reaches the artifact by a sync up.
 */
const artifactValues = [
  'Icon',
  'Button',
  'TextField',
  'TextArea',
  'Select',
  'Combobox',
  'DatePicker',
  'TimePicker',
  'Checkbox',
  'RadioGroup',
  'Switch',
  'Badge',
  'Banner',
  'Toast',
  'EmptyState',
  'Skeleton',
  'Tooltip',
  'Card',
  'Table',
  'Pagination',
  'Tabs',
  'Menu',
  'Dialog',
  'Drawer',
  'AppShell',
  'PageBody',
  'FilterBar',
  'FormSection',
  'FormActions',
  'DetailList',
  'AuthLayout',
  'NavRail',
  'PageHeader',
  'Schedule',
  'ScheduleKey',
  'PatientHeader',
  'VisitNote',
  'Timeline',
  'LabResults',
  'InvoiceTable',
  'PrintPreview',
  'PrintSheet',
  'Letterhead',
  'PrintSection',
  'SignatureBlock',
  'Receipt',
  'BarChart',
  'LineChart',
  'BarList',
  'HeatGrid',
  'Stat',
  'StatGroup',
  'Toaster',
  'toast',
  'dismissToast',
  'appointmentBadge',
  'formatNumber',
  'formatMoney',
  'parseNumber',
  'formatDate',
  'formatTime',
  'formatAge',
  'formatDuration',
  'formatPhone',
  'formatCount',
  'plural',
  'compareText',
]

/**
 * Added in the repo since the fork point (ADR 0005): the money wrapper of ticket #13, minor units to an amount (IN-4),
 * and its bare form for a table cell (#25).
 */
const repoValues = ['formatMinorUnits', 'formatMinorUnitsPlain']

const artifactTypes = [
  'IconProps',
  'IconName',
  'ButtonProps',
  'FieldProps',
  'TextFieldProps',
  'TextAreaProps',
  'SelectProps',
  'SelectOption',
  'ComboboxProps',
  'ComboOption',
  'DatePickerProps',
  'DatePickerLabels',
  'TimePickerProps',
  'CheckboxProps',
  'RadioGroupProps',
  'RadioOption',
  'SwitchProps',
  'BadgeProps',
  'BannerProps',
  'ToastProps',
  'MessageAction',
  'EmptyStateProps',
  'SkeletonProps',
  'TooltipProps',
  'CardProps',
  'TableProps',
  'TableColumn',
  'TableSort',
  'PaginationProps',
  'TabsProps',
  'TabItem',
  'MenuProps',
  'MenuItem',
  'DialogProps',
  'DrawerProps',
  'AppShellProps',
  'PageBodyProps',
  'FilterBarProps',
  'FormSectionProps',
  'FormActionsProps',
  'DetailListProps',
  'DetailItem',
  'AuthLayoutProps',
  'NavRailProps',
  'NavItem',
  'NavSection',
  'NavAccount',
  'PageHeaderProps',
  'PageHeaderBack',
  'ScheduleProps',
  'ScheduleColumn',
  'ScheduleEvent',
  'ScheduleBlock',
  'ScheduleKeyProps',
  'ScheduleKeyItem',
  'PatientHeaderProps',
  'PatientFact',
  'PatientAlert',
  'PatientOwner',
  'VisitNoteProps',
  'VitalField',
  'NoteSection',
  'VisitNoteLabels',
  'TimelineProps',
  'TimelineItem',
  'LabResultsProps',
  'LabResult',
  'LabResultsLabels',
  'InvoiceTableProps',
  'InvoiceLine',
  'InvoiceTotal',
  'InvoiceLabels',
  'PrintPreviewProps',
  'PrintSheetProps',
  'LetterheadProps',
  'PrintFact',
  'PrintSectionProps',
  'SignatureBlockProps',
  'Signature',
  'ReceiptProps',
  'ReceiptLine',
  'ReceiptAmount',
  'ChartColor',
  'ChartSeries',
  'ChartLabels',
  'ChartCommonProps',
  'BarChartProps',
  'LineChartProps',
  'BarListProps',
  'BarListItem',
  'HeatGridProps',
  'StatProps',
  'StatDelta',
  'StatGroupProps',
  'ToasterProps',
  'ToastOptions',
  'AppointmentStatus',
  'NumberOptions',
  'DateOptions',
  'DateStyle',
  'AgeOptions',
  'PluralForms',
  'Status',
]

/** The names index.ts re-exports as types; `pnpm typecheck` proves each one exists in its module. */
function typeExports(): string[] {
  const source = readFileSync(new URL('index.ts', import.meta.url), 'utf8')
  return [...source.matchAll(/export type \{([^}]+)\}/g)]
    .flatMap((m) => m[1].split(','))
    .map((n) => n.trim())
    .filter(Boolean)
}

describe('@vetora/ui, the artifact’s component index vendored (ADR 0003) and the repo’s additions since (ADR 0005)', () => {
  it('exports every value the artifact’s index exported at the fork point and every repo addition, and nothing else', () => {
    expect(Object.keys(ui).sort()).toEqual([...artifactValues, ...repoValues].sort())
  })

  it('exports every type the artifact’s index exports, and nothing else', () => {
    expect(typeExports().sort()).toEqual([...artifactTypes].sort())
  })

  it('exports the print components, which are compiled here and rendered to PDF only by the worker (ADR 0004)', () => {
    for (const name of ['PrintPreview', 'PrintSheet', 'Letterhead', 'PrintSection', 'SignatureBlock', 'Receipt']) {
      expect(typeof (ui as Record<string, unknown>)[name], name).toBe('function')
    }
  })
})

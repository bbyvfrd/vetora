import * as React from 'react'
import { Card } from './Card.js'
import { FieldShell } from './Field.js'
import { parseNumber } from './format.js'
import { Icon } from './Icon.js'
import { TextArea } from './TextArea.js'
import { cx } from './util.js'

export interface VitalField {
  id: string
  /** "Temperature", "Pulse", "Respiratory rate", "Weight", in the interface language. */
  label: string
  /** Unit after the value: "°C", "/min", "kg". */
  unit: string
  /** The value as typed. */
  value: string
  /** Lower and upper end of the normal range for this species. A value outside is flagged, not refused. */
  low?: number
  high?: number
  /** The last recorded value, written out: "3,9 kg on 03.06.2026". */
  previous?: string
  /** What to enter, shown under the field when the value cannot be saved: "Enter the temperature in °C, such as 38.5". */
  error?: string
  /** Shows the value without letting it change: a person who may not record this sign reads it. */
  readOnly?: boolean
}

export interface NoteSection {
  id: string
  /** Heading of the section, from the glossary: "Reason for visit", "Examination", "Diagnosis". */
  label: string
  placeholder?: string
  /** Lines shown while empty. Default 2. */
  rows?: number
  required?: boolean
  hint?: string
  /** What to enter, shown under the section when the visit cannot be completed without it: "Enter the reason for visit". */
  error?: string
}

export interface VisitNoteLabels {
  /** The words for a vital sign above and below its range: "High", "Low". */
  high: string
  low: string
  /** What a section with nothing in it shows when the note is read-only: "Not recorded". */
  empty: string
}

export interface VisitNoteProps {
  /** Heading of the note: "Visit note". */
  title: string
  /** Under the title: the date and the vet. */
  subtitle?: React.ReactNode
  /** Name of the group of vital signs: "Vital signs". Required when `vitals` is given. */
  vitalsLabel?: string
  vitals?: VitalField[]
  onVitalChange?: (id: string, value: string) => void
  /** Called when a vital sign loses the focus: the moment to save the value typed in it. */
  onVitalBlur?: (id: string) => void
  /** The text sections, in the order the vet works through them. */
  sections: NoteSection[]
  /** Text of each section, by id. */
  values: Record<string, string>
  onChange?: (id: string, value: string) => void
  /** Called when a section loses the focus: the moment to save what was typed in it. */
  onSectionBlur?: (id: string) => void
  /** Shows the note as text. For a signed note, and for past visits. */
  readOnly?: boolean
  /**
   * Shows the sections as text while the vital signs stay fields: for a person who records a vital sign but does not
   * write the note, such as a receptionist weighing the patient.
   */
  readOnlySections?: boolean
  /** Whether what is typed has reached the server. */
  saveState?: 'saved' | 'saving' | 'unsaved' | 'error'
  /** The save state in words: "Saved at 14:32", "Saving", "Not saved. Check the connection". */
  saveLabel?: string
  labels: VisitNoteLabels
  /** Buttons at the bottom: "Complete visit". */
  footer?: React.ReactNode
  className?: string
}

function Vital({
  field,
  labels,
  onChange,
  onBlur,
}: {
  field: VitalField
  labels: VisitNoteLabels
  onChange?: (id: string, value: string) => void
  onBlur?: (id: string) => void
}) {
  const auto = React.useId()
  const n = parseNumber(field.value)
  const flag =
    n === null
      ? null
      : field.high !== undefined && n > field.high
        ? 'high'
        : field.low !== undefined && n < field.low
          ? 'low'
          : null
  const noted = flag || field.previous ? `${auto}-note` : undefined
  const described = [noted, field.error ? `${auto}-msg` : undefined].filter(Boolean).join(' ') || undefined
  return (
    <FieldShell fieldId={auto} label={field.label} error={field.error}>
      <div className={cx('vt-input', 'vt-input-md', field.error && 'is-invalid')}>
        <input
          id={auto}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={field.value}
          readOnly={field.readOnly}
          aria-invalid={field.error ? true : undefined}
          aria-describedby={described}
          onChange={(e) => onChange?.(field.id, e.target.value)}
          onBlur={() => onBlur?.(field.id)}
        />
        <span className="vt-input-suffix">{field.unit}</span>
      </div>
      {noted ? (
        <p id={noted} className="vt-vital-note">
          {flag ? (
            <span className="vt-vital-flag">
              <Icon name={flag === 'high' ? 'arrow_upward' : 'arrow_downward'} size="sm" />
              {labels[flag]}
            </span>
          ) : null}
          {field.previous ? <span>{field.previous}</span> : null}
        </p>
      ) : null}
    </FieldShell>
  )
}

const SAVE_ICON = { saved: 'check_circle', unsaved: 'edit', error: 'error' } as const

/** The record of one visit: vital signs, then the vet's notes section by section. Editable, or read-only once signed. */
export function VisitNote({
  title,
  subtitle,
  vitalsLabel,
  vitals,
  onVitalChange,
  onVitalBlur,
  sections,
  values,
  onChange,
  onSectionBlur,
  readOnly = false,
  readOnlySections = false,
  saveState,
  saveLabel,
  labels,
  footer,
  className,
}: VisitNoteProps) {
  const status =
    saveState && saveLabel ? (
      <span className={cx('vt-note-status', `is-${saveState}`)} role="status">
        {saveState === 'saving' ? (
          <span className="vt-spinner" aria-hidden="true" />
        ) : (
          <Icon name={SAVE_ICON[saveState]} size="sm" filled={saveState !== 'unsaved'} />
        )}
        <span>{saveLabel}</span>
      </span>
    ) : undefined

  if (readOnly) {
    return (
      <Card title={title} subtitle={subtitle} footer={footer} padding="lg" className={cx('vt-note', className)}>
        <dl className="vt-note-read">
          {vitals?.length ? (
            <div>
              <dt>{vitalsLabel}</dt>
              <dd className="vt-note-vitals">
                {vitals.map((v) => {
                  const n = parseNumber(v.value)
                  const flag =
                    n === null
                      ? null
                      : v.high !== undefined && n > v.high
                        ? 'high'
                        : v.low !== undefined && n < v.low
                          ? 'low'
                          : null
                  return (
                    <span key={v.id}>
                      <span className="vt-note-vital-name">{v.label}</span>
                      <span className={cx(flag && 'vt-vital-flag')}>
                        {flag ? (
                          <Icon
                            name={flag === 'high' ? 'arrow_upward' : 'arrow_downward'}
                            size="sm"
                            label={labels[flag]}
                          />
                        ) : null}
                        {v.value ? `${v.value} ${v.unit}` : labels.empty}
                      </span>
                    </span>
                  )
                })}
              </dd>
            </div>
          ) : null}
          <SectionsRead sections={sections} values={values} labels={labels} />
        </dl>
      </Card>
    )
  }
  return (
    <Card
      title={title}
      subtitle={subtitle}
      actions={status}
      footer={footer}
      padding="lg"
      className={cx('vt-note', className)}
    >
      {vitals?.length ? (
        <fieldset className="vt-vitals">
          <legend className="vt-label">{vitalsLabel}</legend>
          <div className="vt-vitals-grid">
            {vitals.map((v) => (
              <Vital key={v.id} field={v} labels={labels} onChange={onVitalChange} onBlur={onVitalBlur} />
            ))}
          </div>
        </fieldset>
      ) : null}
      {readOnlySections ? (
        <dl className="vt-note-read">
          <SectionsRead sections={sections} values={values} labels={labels} />
        </dl>
      ) : (
        <div className="vt-note-sections">
          {sections.map((s) => (
            <TextArea
              key={s.id}
              label={s.label}
              placeholder={s.placeholder}
              hint={s.hint}
              error={s.error}
              required={s.required}
              rows={s.rows || 2}
              autoGrow
              maxRows={20}
              value={values[s.id] || ''}
              onChange={(e) => onChange?.(s.id, e.target.value)}
              onBlur={() => onSectionBlur?.(s.id)}
            />
          ))}
        </div>
      )}
    </Card>
  )
}

/** The sections as text, each heading over its words or `labels.empty`, inside the caller's `dl`. */
function SectionsRead({
  sections,
  values,
  labels,
}: {
  sections: NoteSection[]
  values: Record<string, string>
  labels: VisitNoteLabels
}) {
  return (
    <>
      {sections.map((s) => (
        <div key={s.id}>
          <dt>{s.label}</dt>
          <dd className={cx(!values[s.id] && 'is-empty')}>{values[s.id] || labels.empty}</dd>
        </div>
      ))}
    </>
  )
}

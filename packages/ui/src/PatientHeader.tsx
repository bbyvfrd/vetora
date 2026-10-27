import type * as React from 'react'
import { Badge } from './Badge.js'
import { Icon } from './Icon.js'
import type { IconName } from './icons.js'
import type { PageHeaderBack } from './PageHeader.js'
import { cx, type Status } from './util.js'

export interface PatientFact {
  /** What the value is, in the interface language: "Species", "Weight". */
  label: string
  value: React.ReactNode
  /** An icon before the value: `female`, `male`. */
  icon?: IconName
}

export interface PatientAlert {
  /** The alert in words: "Allergy: penicillin", "Aggressive". */
  label: string
  /** danger (default) for what can hurt the patient or the staff; warning for what needs care. */
  status?: Status
  icon?: IconName
}

export interface PatientOwner {
  /** The word for owner in the interface language. */
  label: string
  name: string
  /** Link to the client's record. */
  href?: string
  onClick?: (event: React.MouseEvent) => void
  /** Phone number as written. It becomes a link that dials. */
  phone?: string
  /** What the client owes, as one line: "Borc: 58,00 ₼" (messages.md, `balance.due`). After the phone; left out when nothing is owed. */
  balance?: string
}

export interface PatientHeaderProps {
  /** The patient's name. */
  name: string
  /** Address of a photo. Without one, the paw icon is shown. */
  photo?: string
  /** Species, breed, sex, age, weight, microchip: in that order, as many as are known. */
  facts: PatientFact[]
  /** What everyone handling the patient must know. Shown beside the name, always visible. */
  alerts?: PatientAlert[]
  owner?: PatientOwner
  /** A word shown as a badge when the record is closed: "Deceased", "Archived". */
  inactiveLabel?: string
  /** Link back to the list, as in PageHeader. md only. */
  back?: PageHeaderBack
  /** Buttons on the right: at most one primary, placed last. */
  actions?: React.ReactNode
  /** Bottom slot of the md size, for the record's Tabs. */
  children?: React.ReactNode
  /** md (default): the top of the patient's page, in place of a PageHeader. sm: inside a drawer, a card or the visit page. */
  size?: 'md' | 'sm'
  /** Heading level of the name. Default 1 for md, 3 for sm. */
  headingLevel?: 1 | 2 | 3
  className?: string
}

/** Who the patient is, at the top of everything about them: name, alerts, key facts and the owner. */
export function PatientHeader({
  name,
  photo,
  facts,
  alerts = [],
  owner,
  inactiveLabel,
  back,
  actions,
  children,
  size = 'md',
  headingLevel,
  className,
}: PatientHeaderProps) {
  const Heading = `h${headingLevel || (size === 'md' ? 1 : 3)}` as 'h1' | 'h2' | 'h3'
  const row = (
    <div className="vt-patient-row">
      <span className={cx('vt-patient-avatar', inactiveLabel && 'is-inactive')} aria-hidden="true">
        {photo ? <img src={photo} alt="" /> : <Icon name="pets" size={size === 'md' ? 'lg' : 'md'} filled />}
      </span>
      <div className="vt-patient-main">
        <div className="vt-patient-title">
          <Heading>{name}</Heading>
          {inactiveLabel ? <Badge>{inactiveLabel}</Badge> : null}
          {alerts.map((a) => {
            const status = a.status || 'danger'
            return (
              <Badge
                key={a.label}
                status={status}
                solid={status === 'danger'}
                icon={a.icon || (status === 'danger' ? 'error' : 'warning')}
              >
                {a.label}
              </Badge>
            )
          })}
        </div>
        <dl className="vt-patient-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>
                {f.icon ? <Icon name={f.icon} size="sm" /> : null}
                <span>{f.value}</span>
              </dd>
            </div>
          ))}
          {owner ? (
            <div>
              <dt>{owner.label}</dt>
              <dd>
                {owner.href || owner.onClick ? (
                  <a href={owner.href || '#'} onClick={owner.onClick}>
                    {owner.name}
                  </a>
                ) : (
                  <span>{owner.name}</span>
                )}
                {owner.phone ? (
                  <a className="vt-patient-phone" href={`tel:${owner.phone.replace(/[^\d+]/g, '')}`}>
                    {owner.phone}
                  </a>
                ) : null}
                {owner.balance ? <span className="vt-patient-balance">{owner.balance}</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
      {actions ? <div className="vt-page-actions">{actions}</div> : null}
    </div>
  )
  if (size === 'sm') return <div className={cx('vt-patient', 'vt-patient-sm', className)}>{row}</div>
  return (
    <header className={cx('vt-page-head', 'vt-patient', 'vt-patient-md', children ? 'has-tabs' : undefined, className)}>
      {back ? (
        back.href ? (
          <a className="vt-page-back" href={back.href} onClick={back.onClick}>
            <Icon name="arrow_back" size="sm" />
            <span>{back.label}</span>
          </a>
        ) : (
          <button type="button" className="vt-page-back" onClick={back.onClick}>
            <Icon name="arrow_back" size="sm" />
            <span>{back.label}</span>
          </button>
        )
      ) : null}
      {row}
      {children ? <div className="vt-page-slot">{children}</div> : null}
    </header>
  )
}

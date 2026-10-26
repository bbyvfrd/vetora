import { describe, expect, it } from 'vitest'
import { type Action, can, joinRoles, parseRoles, STAFF_ROLES, type StaffRole } from './staff.js'

/**
 * Spec #18's matrix ("Contracts"), written out per role from the spec's table rather than from `permissions`, so a
 * changed row in the code disagrees with this one.
 */
const allowedBySpec: Record<StaffRole, Action[]> = {
  manager: ['registerClientsAndPatients', 'invoiceAndTakePayment', 'readRecords'],
  veterinarian: [
    'registerClientsAndPatients',
    'recordWeight',
    'recordVitalSignsAndNote',
    'conductEncounter',
    'invoiceAndTakePayment',
    'readRecords',
  ],
  assistant: [
    'registerClientsAndPatients',
    'recordWeight',
    'recordVitalSignsAndNote',
    'invoiceAndTakePayment',
    'readRecords',
  ],
  receptionist: ['registerClientsAndPatients', 'recordWeight', 'invoiceAndTakePayment', 'readRecords'],
  groomer: [],
}

const actions: Action[] = [
  'registerClientsAndPatients',
  'recordWeight',
  'recordVitalSignsAndNote',
  'conductEncounter',
  'invoiceAndTakePayment',
  'readRecords',
]

describe('the permission matrix (spec #18, Contracts; story 74)', () => {
  it('holds exactly the five staff roles', () => {
    expect([...STAFF_ROLES].sort()).toEqual(['assistant', 'groomer', 'manager', 'receptionist', 'veterinarian'])
  })

  it.each(STAFF_ROLES)('lets a %s perform the actions of its row in the spec and no other', (role) => {
    expect(actions.filter((action) => can([role], action))).toEqual(allowedBySpec[role])
  })

  it('lets only a veterinarian conduct an Encounter (CR-2), and a groomer read nothing (story 72)', () => {
    expect(STAFF_ROLES.filter((role) => can([role], 'conductEncounter'))).toEqual(['veterinarian'])
    expect(actions.some((action) => can(['groomer'], action))).toBe(false)
  })

  it('gives several roles the union of their rows, and no roles nothing', () => {
    expect(can(['groomer', 'receptionist'], 'recordWeight')).toBe(true)
    expect(can(['manager', 'receptionist'], 'conductEncounter')).toBe(false)
    expect(actions.some((action) => can([], action))).toBe(false)
  })
})

describe('the comma joined roles of a membership (control.member.role, spec #18)', () => {
  it('joins roles once each in the order of the five, and reads them back', () => {
    expect(joinRoles(['receptionist', 'assistant', 'receptionist'])).toBe('assistant,receptionist')
    expect(parseRoles('assistant,receptionist')).toEqual(['assistant', 'receptionist'])
    expect(parseRoles(joinRoles(['groomer', 'manager']))).toEqual(['manager', 'groomer'])
  })

  it('drops what is not one of the five when reading', () => {
    expect(parseRoles('member,veterinarian,')).toEqual(['veterinarian'])
    expect(parseRoles('')).toEqual([])
  })
})

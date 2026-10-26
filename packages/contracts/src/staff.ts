import { z } from 'zod'

/** The five staff roles (docs/domain.md §3): what a member of a practice is, one role or several at once. */
export const STAFF_ROLES = ['manager', 'veterinarian', 'assistant', 'receptionist', 'groomer'] as const
export const StaffRole = z.enum(STAFF_ROLES)
export type StaffRole = z.infer<typeof StaffRole>

/** The staff roles among `held`, once each, in the order of STAFF_ROLES; anything else is dropped. */
export function orderRoles(held: readonly string[]): StaffRole[] {
  return STAFF_ROLES.filter((role) => held.includes(role))
}

/** A membership's roles as Better Auth stores them in `control.member.role`: comma joined, in the order of STAFF_ROLES. */
export function joinRoles(roles: readonly StaffRole[]): string {
  return orderRoles(roles).join(',')
}

/** The roles a membership's comma joined `role` holds; a value outside the five, which its check refuses, is dropped. */
export function parseRoles(joined: string): StaffRole[] {
  return orderRoles(joined.split(','))
}

/**
 * The permission matrix of feature 5 (spec #18, "Contracts"), defined once: each action and the roles that may
 * perform it. The API checks a route's action against the actor's roles before its handler runs (#21) and the web app
 * reads the same table to hide what would be refused; the database still holds CR-2 by trigger.
 */
export const permissions = {
  /** Register and edit clients and patients. */
  registerClientsAndPatients: ['receptionist', 'assistant', 'veterinarian', 'manager'],
  /** Record a weight, the one vital sign whoever is free takes (story 40). */
  recordWeight: ['receptionist', 'assistant', 'veterinarian'],
  /** Record the other vital signs and write the draft note of an Encounter (CR-2: an assistant writes, a vet completes). */
  recordVitalSignsAndNote: ['assistant', 'veterinarian'],
  /** Start an Encounter as its veterinarian, complete it, cancel a draft one (CR-2). */
  conductEncounter: ['veterinarian'],
  /** Invoice an Encounter and take payment. */
  invoiceAndTakePayment: ['receptionist', 'assistant', 'veterinarian', 'manager'],
  /** Read what feature 5 shows: visits, clients, patients and invoices; a groomer reads none of it (story 72). */
  readRecords: ['manager', 'veterinarian', 'assistant', 'receptionist'],
} as const satisfies Record<string, readonly StaffRole[]>

export type Action = keyof typeof permissions

/** Whether a member holding these roles may perform the action: any one role that may is enough. */
export function can(roles: readonly StaffRole[], action: Action): boolean {
  const allowed: readonly StaffRole[] = permissions[action]
  return roles.some((role) => allowed.includes(role))
}

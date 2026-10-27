import { createRoute, type RouteHandler } from '@hono/zod-openapi'
import {
  Breed,
  BreedCreate,
  BreedPath,
  normalisePhone,
  PhoneLookup,
  PhoneLookupResult,
  PracticeHeaders,
  PracticePath,
  Registered,
  Registration,
  SpeciesList,
} from '@vetora/contracts'
import type { Context } from 'hono'
import { clientExists, findClientsByPhone, registerClient } from '../modules/client/index.js'
import { addBreed, listSpecies, ownsPatient, patientsOwnedBy, registerPatient } from '../modules/patient/index.js'
import { problem } from '../platform/problem.js'
import type { Env } from './env.js'
import { practiceRoute, refusals } from './practice-context.js'

/**
 * Registering a client and a pet (#21; spec #18, "Contracts", "Visit and money behaviour": New visit's Save): the
 * species with their breeds, a breed added inline, the phone lookup, and the registration, each behind the request
 * context with the action it performs. Names and phones travel in bodies (spec 0001, "API conventions"); creates
 * carry the client's UUID v7, so a retry changes nothing.
 */

export const speciesRoute = createRoute({
  method: 'get',
  path: '/api/p/{practiceId}/species',
  middleware: [practiceRoute('readRecords')],
  summary: 'The species and their breeds',
  description: 'Every species in its order with its three names, each with its active breeds.',
  request: { params: PracticePath, headers: PracticeHeaders },
  responses: {
    200: { description: 'The species', content: { 'application/json': { schema: SpeciesList } } },
    ...refusals,
  },
})

export const breedRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/breeds/{breedId}',
  middleware: [practiceRoute('registerClientsAndPatients')],
  summary: 'Add a breed',
  description:
    'Adds a breed to a species with one name in the language given. The id is a UUID v7 the client generates: the same request again answers the breed and changes nothing.',
  request: {
    params: BreedPath,
    headers: PracticeHeaders,
    body: { content: { 'application/json': { schema: BreedCreate } }, required: true },
  },
  responses: {
    200: { description: 'The breed was already there', content: { 'application/json': { schema: Breed } } },
    201: { description: 'The breed was added', content: { 'application/json': { schema: Breed } } },
    404: { description: 'No such species (problem details)' },
    409: { description: 'The species has a breed of this name (problem details)' },
    ...refusals,
  },
})

export const lookupRoute = createRoute({
  method: 'post',
  path: '/api/p/{practiceId}/clients/lookup',
  middleware: [practiceRoute('readRecords')],
  summary: 'Find clients by phone',
  description:
    'Every client holding the phone number, written in any common way, each with the patients they own today. A POST, so the number never reaches a URL.',
  request: {
    params: PracticePath,
    headers: PracticeHeaders,
    body: { content: { 'application/json': { schema: PhoneLookup } }, required: true },
  },
  responses: {
    200: { description: 'The clients on the number', content: { 'application/json': { schema: PhoneLookupResult } } },
    ...refusals,
  },
})

export const registrationRoute = createRoute({
  method: 'put',
  path: '/api/p/{practiceId}/registrations',
  middleware: [practiceRoute('registerClientsAndPatients')],
  summary: 'Register a client and a patient',
  description:
    "Writes what is new of the client and the patient in one transaction, a new patient's owner row from the practice's today with it. The new ones carry UUID v7 ids the client generates: the same request again changes nothing.",
  request: {
    params: PracticePath,
    headers: PracticeHeaders,
    body: { content: { 'application/json': { schema: Registration } }, required: true },
  },
  responses: {
    200: { description: 'Registered', content: { 'application/json': { schema: Registered } } },
    404: { description: 'No such client, species or breed (problem details)' },
    409: { description: "The microchip is another patient's, or the patient is not this client's (problem details)" },
    ...refusals,
  },
})

export const getSpecies: RouteHandler<typeof speciesRoute, Env> = async (c) => {
  return c.json({ species: await listSpecies() }, 200)
}

export const putBreed: RouteHandler<typeof breedRoute, Env> = async (c) => {
  const { breedId } = c.req.valid('param')
  const outcome = await addBreed({ id: breedId, ...c.req.valid('json') })
  switch (outcome.status) {
    case 'no-species':
      return problem(c, 404, 'No such species')
    case 'name-taken':
      return problem(c, 409, 'The species has a breed of this name', {
        errors: [{ path: ['name'], code: 'taken', message: 'A breed of this name exists' }],
      })
    case 'created':
      return c.json(outcome.breed, 201)
    case 'existing':
      return c.json(outcome.breed, 200)
  }
}

export const lookUpClients: RouteHandler<typeof lookupRoute, Env> = async (c) => {
  // Validated by the schema, which reads it with the same function.
  const phone = normalisePhone(c.req.valid('json').phone) as string
  const clients = await findClientsByPhone(phone)
  const owned = await patientsOwnedBy(clients.map((found) => found.id))
  return c.json({ phone, clients: clients.map((found) => ({ ...found, patients: owned.get(found.id) ?? [] })) }, 200)
}

/** A refusal of one of the patient's fields, shaped as the validation's issues are. */
const patientFieldProblem = (field: string, code: string, message: string) => ({
  errors: [{ path: ['patient', field], code, message }],
})

/**
 * Write what is new of a registration's client and patient (New visit's Save, and Start visit before its visit, #22):
 * the two ids, the client being the patient's owner today; or the refusal to answer, after which the request context
 * rolls back whatever was written.
 */
export async function register(
  c: Context<Env>,
  { client, patient }: Registration,
): Promise<Registered | { refusal: ReturnType<typeof problem> }> {
  const registered = { clientId: client.id, patientId: patient.id }
  if (client.type === 'existing') {
    if (!(await clientExists(client.id))) return { refusal: problem(c, 404, 'No such client') }
  } else {
    await registerClient({ ...client, phoneNormalised: normalisePhone(client.phone) as string })
  }
  if (patient.type === 'existing') {
    if (!(await ownsPatient(client.id, patient.id))) return { refusal: problem(c, 409, "Not this client's patient") }
    return registered
  }
  const outcome = await registerPatient({ ...patient, ownerId: client.id })
  switch (outcome.status) {
    case 'created':
    case 'existing':
      return registered
    case 'not-owned':
      return { refusal: problem(c, 409, "Not this client's patient") }
    case 'microchip-taken':
      return {
        refusal: problem(
          c,
          409,
          "The microchip is another patient's",
          patientFieldProblem('microchipNumber', 'taken', 'Recorded for another patient'),
        ),
      }
    case 'birth-date-in-future':
      return {
        refusal: problem(c, 400, 'Validation failed', patientFieldProblem('birthDate', 'future', 'Not after today')),
      }
    case 'no-species':
      return { refusal: problem(c, 404, 'No such species') }
    case 'no-breed':
      return { refusal: problem(c, 404, 'No such breed of this species') }
  }
}

export const putRegistration: RouteHandler<typeof registrationRoute, Env> = async (c) => {
  const registered = await register(c, c.req.valid('json'))
  return 'refusal' in registered ? registered.refusal : c.json(registered, 200)
}

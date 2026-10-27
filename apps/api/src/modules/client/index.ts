/**
 * The public interface of the Client module (spec 0001, "Repository layout"): finding clients by phone and registering
 * a client with their phone (#21); what a patient header shows of its owner, and names by id (#22). Every function
 * runs in the request's transaction.
 */
export {
  type ClientInput,
  type ClientMatch,
  type ClientName,
  clientCard,
  clientExists,
  clientNames,
  findClientsByPhone,
  registerClient,
} from './clients.js'

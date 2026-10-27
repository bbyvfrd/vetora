/**
 * The public interface of the Client module (spec 0001, "Repository layout"): finding clients by phone and registering
 * a client with their phone (#21). Every function runs in the request's transaction.
 */
export {
  type ClientInput,
  type ClientMatch,
  clientExists,
  findClientsByPhone,
  registerClient,
} from './clients.js'

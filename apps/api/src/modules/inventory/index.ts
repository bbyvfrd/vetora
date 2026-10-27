/**
 * The public interface of the Inventory module (spec 0001, "Repository layout"): the price list, loaded from a file by
 * `load-services`, searched by the visit page, and priced into an invoice line by billing (#25).
 */
export {
  type LoadOutcome,
  loadInput,
  loadServices,
  type PricedService,
  priceList,
  type ServiceEntry,
  serviceForLine,
  servicesFile,
} from './services.js'

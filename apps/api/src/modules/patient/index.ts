/**
 * The public interface of the Patient module (spec 0001, "Repository layout"): the species and breeds, a patient
 * registered with its owner, and the patients a client owns (#21). Every function runs in the request's transaction.
 */
export {
  addBreed,
  type BreedInput,
  type BreedOutcome,
  listSpecies,
  type OwnedPatient,
  ownsPatient,
  type PatientInput,
  type PatientOutcome,
  patientsOwnedBy,
  registerPatient,
} from './patients.js'

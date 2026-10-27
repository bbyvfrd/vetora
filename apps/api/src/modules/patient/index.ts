/**
 * The public interface of the Patient module (spec 0001, "Repository layout"): the species and breeds, a patient
 * registered with its owner, and the patients a client owns (#21); what a patient header shows, and names by id
 * (#22). Every function runs in the request's transaction.
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
  patientCard,
  patientNames,
  patientsOwnedBy,
  registerPatient,
} from './patients.js'

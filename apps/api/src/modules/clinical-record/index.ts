/**
 * The public interface of the Clinical Record module (spec 0001, "Repository layout"): a visit started, read, its note
 * saved, completed or cancelled, and the day's visits at a location (#22); a vital sign recorded on a visit, the
 * visit's readings, and the patient's last weight (#23). Every function runs in the request's transaction.
 */
export {
  type ChangeOutcome,
  cancelEncounter,
  completeEncounter,
  type NoteText,
  readEncounter,
  type StartOutcome,
  saveNote,
  startEncounter,
  visitsToday,
} from './encounters.js'
export {
  lastWeight,
  type ObservationKind,
  type ObservationRow,
  type RecordOutcome,
  recordObservation,
  visitObservations,
} from './observations.js'

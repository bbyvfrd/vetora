/**
 * The public interface of the Identity & Access module (spec 0001, "Repository layout"): the staff service, through
 * which every login and every membership of a practice is made (spec #18, "Identity and access").
 */
export {
  addStaff,
  type ResetInput,
  resetInput,
  resetStaffPassword,
  type StaffInput,
  type StaffOutcome,
  staffInput,
  type UnlockInput,
  unlockInput,
  unlockLogin,
} from './staff.js'

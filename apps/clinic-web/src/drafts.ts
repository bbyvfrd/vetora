import type { VisitNote } from '@vetora/contracts'

/**
 * The draft note's copy on this computer (#24; spec #18, "Visit and money behaviour"; spec 0001, "API conventions":
 * drafts survive bad connections): IndexedDB holds the six sections as last typed, keyed by the person and the visit,
 * with the server version the text started from and when it was kept. The key holds the person, so a copy is only
 * ever offered back to whoever typed it; signing out deletes every copy of that person, and a session that ends on
 * its own keeps them for the same person's next sign in. Storage that is unavailable (a private window, a full disk)
 * leaves the note to the server alone: every call here resolves, and a failed read finds nothing. Nothing of a copy
 * ever leaves the computer.
 */

/** One kept copy: a draft's text as this person last typed it on this computer. */
export type KeptDraft = {
  personId: string
  visitId: string
  note: VisitNote
  /** The note's version on the server when this text was typed over it. */
  baseVersion: number
  /** When the copy was written, as an ISO instant. */
  keptAt: string
}

const databaseName = 'vetora'
const storeName = 'draftNotes'

/** The open database for the IndexedDB this page has: one connection, opened again if the factory changes (tests). */
let opened: { factory: IDBFactory; database: Promise<IDBDatabase> } | undefined

function database(): Promise<IDBDatabase> {
  const factory = globalThis.indexedDB
  if (opened?.factory === factory) return opened.database
  const database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(databaseName, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName, { keyPath: ['personId', 'visitId'] })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  opened = { factory, database }
  // A failed open is tried again on the next call.
  database.catch(() => {
    if (opened?.database === database) opened = undefined
  })
  return database
}

/**
 * Every call below waits for the ones asked before it, so the copies change in the order the page asked: a delete
 * once the server holds the text never overtakes the write before it, and sign out deletes after a page that was just
 * left has kept its last text.
 */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Run `work` in one transaction on the store, after every earlier call, and resolve with what its request returned
 * once it commits, or with `undefined` when there is no storage.
 */
function inStore(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<unknown> {
  const run = async () => {
    try {
      const transaction = (await database()).transaction(storeName, mode)
      const request = work(transaction.objectStore(storeName))
      return await new Promise<unknown>((resolve, reject) => {
        transaction.oncomplete = () => resolve(request.result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } catch {
      // no storage: the note rests on the server saves alone
      return undefined
    }
  }
  const done = queue.then(run)
  queue = done
  return done
}

/** Keep `draft` on this computer, over any earlier copy of the same person and visit. */
export async function keepDraft(draft: KeptDraft): Promise<void> {
  await inStore('readwrite', (store) => store.put(draft))
}

/** The copy this person kept of this visit's note, if any. */
export async function keptDraft(personId: string, visitId: string): Promise<KeptDraft | undefined> {
  return (await inStore('readonly', (store) => store.get([personId, visitId]))) as KeptDraft | undefined
}

/** Delete this person's copy of this visit's note. */
export async function forgetDraft(personId: string, visitId: string): Promise<void> {
  await inStore('readwrite', (store) => store.delete([personId, visitId]))
}

/** Delete every copy this person kept, at sign out. */
export async function forgetDraftsOf(personId: string): Promise<void> {
  // Every key [personId, visitId] lies between [personId] and [personId, []]: an array sorts after any string.
  await inStore('readwrite', (store) => store.delete(IDBKeyRange.bound([personId], [personId, []])))
}

/** Resolves once every call asked so far is done (the DOM tests wait for a page's last writes between tests). */
export const draftsSettled = (): Promise<void> => queue.then(() => undefined)

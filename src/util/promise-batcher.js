import Rx from 'rxjs'

// Give two Sets; will spit out a new Set containing everything in a that wasn't in b
const diffSets = (a, b) => new Set([...a].filter(el => !b.has(el)))

// Given a RxJS Subject + Observable, makes that Observable pausable by sending bools to Subject
const createPausable = (subject, observer) => subject.switchMap(running =>
    Rx.Observable.if(() => running, observer(), Rx.Observable.empty()))

/**
 * Given a Set of input and an async function, will attempt to concurrently batch fetch them in the background.
 *
 * @param {Set} batch The total batch of input to operate on.
 * @param {(input: any) => Promise<any>} callback The async callback to run each input on.
 * @param {number} [concurrency=5] How many promises to be waiting at any time.
 * @returns {any} Object containing batch handling functions.
 */
function initBatch(batch, callback, concurrency = 5) {
    // State to keep track of progress
    const processed = new Set()

    // Uses mergeMap to handle concurrently processing the deferred promises
    const batchObservable = data => Rx.Observable.from(data)
        .mergeMap(
            input => Rx.Observable.defer(() => callback(input)),
            (input, result) => ({ input, result }),
            concurrency,
        )
        .do(({ input }) => processed.add(input))  // Update state as input gets processed

    // Pauser subject to handle stopping, starting and resuming operations on input observable
    const pauser = createPausable(new Rx.Subject(), () => batchObservable(diffSets(batch, processed)))

    // Interface to use this batch
    return {
        pause: () => pauser.next(false),
        resume: () => pauser.next(true),
        getProgress: () => processed,
        // Clear state + force complete subject to stop acting on input
        terminate: () => processed.clear() && pauser.complete(),
        subscribe(observer) {
            const sub = pauser.subscribe(observer)
            pauser.next(true)   // Make sure pauser is set to run
            return sub          // Allow caller to manage sub
        },
    }
}

// Export a HOF that binds callbacks to a batch initialser
export default callback => (batch, concurrency) => initBatch(batch, callback, concurrency)

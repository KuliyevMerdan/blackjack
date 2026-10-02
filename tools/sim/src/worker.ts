import { parentPort } from 'node:worker_threads';
import { perform, task } from './tasks.js';

/** A pool thread: one task in, one result out, until the pool lets it go. */
parentPort?.on('message', (message: unknown) => {
  parentPort?.postMessage(perform(task.parse(message)));
});

import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { Result, Task } from './tasks.js';

/**
 * Runs tasks across worker threads, at most one in flight per thread, and hands each result to
 * `onResult` as it lands. The shuffle is the cost (85 µs a shoe) and it is per round, so rounds
 * split across threads with nothing shared.
 */
export async function runPool(
  tasks: readonly Task[],
  onResult: (result: Result) => void,
  threads = availableParallelism(),
): Promise<void> {
  const queue = [...tasks];
  const workers = Array.from(
    { length: Math.min(threads, queue.length) },
    () => new Worker(new URL('./worker.js', import.meta.url)),
  );
  await Promise.all(
    workers.map(
      (worker) =>
        new Promise<void>((resolve, reject) => {
          const next = () => {
            const t = queue.shift();
            if (t === undefined) {
              void worker.terminate().then(() => resolve());
              return;
            }
            worker.postMessage(t);
          };
          worker.on('message', (result: Result) => {
            onResult(result);
            next();
          });
          worker.on('error', reject);
          next();
        }),
    ),
  );
}

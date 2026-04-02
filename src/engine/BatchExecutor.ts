/**
 * Executes async tasks with a concurrency limit using a semaphore pattern.
 * Results are returned in the same order as the input tasks.
 */
export class BatchExecutor {
  private maxConcurrent: number;

  constructor(maxConcurrent: number = Infinity) {
    this.maxConcurrent = maxConcurrent;
  }

  async execute<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    if (this.maxConcurrent === Infinity || this.maxConcurrent >= tasks.length) {
      return Promise.all(tasks.map((t) => t()));
    }

    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;
    let running = 0;

    return new Promise((resolve, reject) => {
      let settled = false;
      let completed = 0;

      const runNext = (): void => {
        while (running < this.maxConcurrent && nextIndex < tasks.length) {
          const index = nextIndex++;
          running++;

          const task = tasks[index]!;
          task()
            .then((result) => {
              if (settled) return;
              results[index] = result;
              running--;
              completed++;

              if (completed === tasks.length) {
                settled = true;
                resolve(results);
              } else {
                runNext();
              }
            })
            .catch((err) => {
              if (settled) return;
              settled = true;
              reject(err);
            });
        }
      };

      if (tasks.length === 0) {
        resolve([]);
        return;
      }

      runNext();
    });
  }
}

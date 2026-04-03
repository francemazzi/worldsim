export type SettledResult<T> =
  | { status: "fulfilled"; value: T; index: number }
  | { status: "rejected"; error: Error; index: number };

/**
 * Executes async tasks with a concurrency limit using a semaphore pattern.
 * Results are returned in the same order as the input tasks.
 */
export class BatchExecutor {
  private maxConcurrent: number;

  constructor(maxConcurrent: number = 100) {
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

  /**
   * Like execute(), but never rejects on individual task failure.
   * Failed tasks are captured as { status: "rejected" } results.
   */
  async executeSettled<T>(
    tasks: Array<() => Promise<T>>,
  ): Promise<SettledResult<T>[]> {
    if (tasks.length === 0) return [];

    if (this.maxConcurrent === Infinity || this.maxConcurrent >= tasks.length) {
      const promises = tasks.map((t, i) =>
        t()
          .then((value): SettledResult<T> => ({ status: "fulfilled", value, index: i }))
          .catch((err): SettledResult<T> => ({
            status: "rejected",
            error: err instanceof Error ? err : new Error(String(err)),
            index: i,
          })),
      );
      return Promise.all(promises);
    }

    const results: SettledResult<T>[] = new Array(tasks.length);
    let nextIndex = 0;
    let running = 0;

    return new Promise((resolve) => {
      let completed = 0;

      const runNext = (): void => {
        while (running < this.maxConcurrent && nextIndex < tasks.length) {
          const index = nextIndex++;
          running++;

          const task = tasks[index]!;
          task()
            .then((value) => {
              results[index] = { status: "fulfilled", value, index };
            })
            .catch((err) => {
              results[index] = {
                status: "rejected",
                error: err instanceof Error ? err : new Error(String(err)),
                index,
              };
            })
            .finally(() => {
              running--;
              completed++;

              if (completed === tasks.length) {
                resolve(results);
              } else {
                runNext();
              }
            });
        }
      };

      runNext();
    });
  }
}

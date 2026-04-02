/**
 * Fixed-capacity circular buffer that behaves like an array.
 * When full, new items overwrite the oldest entries.
 * Supports push() and iteration, compatible with ReadonlyArray consumers.
 */
export class CircularBuffer<T> {
  private buffer: (T | undefined)[];
  private head = 0;
  private _size = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  get length(): number {
    return this._size;
  }

  push(...items: T[]): number {
    for (const item of items) {
      this.buffer[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
      if (this._size < this.capacity) {
        this._size++;
      }
    }
    return this._size;
  }

  /**
   * Returns items in insertion order (oldest first).
   */
  toArray(): T[] {
    if (this._size === 0) return [];
    const result: T[] = new Array(this._size);
    const start = this._size < this.capacity ? 0 : this.head;
    for (let i = 0; i < this._size; i++) {
      result[i] = this.buffer[(start + i) % this.capacity] as T;
    }
    return result;
  }

  [Symbol.iterator](): Iterator<T> {
    const buf = this.buffer;
    const size = this._size;
    const cap = this.capacity;
    const start = size < cap ? 0 : this.head;
    let i = 0;
    return {
      next(): IteratorResult<T> {
        if (i >= size) return { done: true, value: undefined };
        const value = buf[(start + i) % cap] as T;
        i++;
        return { done: false, value };
      },
    };
  }

  flat(): T[] {
    return this.toArray();
  }
}

export class WorldClock {
  private _tick = 0;
  private _startedAt: Date = new Date();

  increment(): number {
    this._tick += 1;
    return this._tick;
  }

  current(): number {
    return this._tick;
  }

  elapsed(): number {
    return Date.now() - this._startedAt.getTime();
  }

  reset(): void {
    this._tick = 0;
    this._startedAt = new Date();
  }
}

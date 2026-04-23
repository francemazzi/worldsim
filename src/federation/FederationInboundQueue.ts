import type { CrossWorldEnvelope } from "./types.js";

/**
 * Buffers envelopes that arrive from the transport between local ticks.
 *
 * Inbound envelopes cannot be applied to the local `MessageBus` immediately:
 * the bus is keyed by the local world's current tick, and federated arrivals
 * happen asynchronously from another world's clock. The `TickOrchestrator`
 * drains the queue at the *start* of each tick so the contents are visible
 * during that tick's agent activations.
 *
 * The queue is intentionally simple: FIFO, in-process, no persistence.
 * Phase 4 idempotency (de-duplication by `envelope.id`) lives in the
 * `AgentMigrationService`, not here.
 */
export class FederationInboundQueue {
  private buffer: CrossWorldEnvelope[] = [];

  push(envelope: CrossWorldEnvelope): void {
    this.buffer.push(envelope);
  }

  drain(): CrossWorldEnvelope[] {
    if (this.buffer.length === 0) return [];
    const out = this.buffer;
    this.buffer = [];
    return out;
  }

  size(): number {
    return this.buffer.length;
  }
}

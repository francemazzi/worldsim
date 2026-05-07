import type { Entity, EntityKind, EntityRegistry } from "../types/EntityTypes.js";

/**
 * In-memory implementation of {@link EntityRegistry}. Mirrors
 * {@link AgentRegistry} so the rest of the engine can treat agents and
 * entities uniformly when needed.
 */
export class InMemoryEntityRegistry implements EntityRegistry {
  private readonly entities: Map<string, Entity> = new Map();
  private readonly byKind: Map<EntityKind, Set<string>> = new Map();

  add(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      this.remove(entity.id);
    }
    this.entities.set(entity.id, entity);
    let bucket = this.byKind.get(entity.kind);
    if (!bucket) {
      bucket = new Set();
      this.byKind.set(entity.kind, bucket);
    }
    bucket.add(entity.id);
  }

  remove(id: string): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.entities.delete(id);
    const bucket = this.byKind.get(entity.kind);
    if (bucket) {
      bucket.delete(id);
      if (bucket.size === 0) this.byKind.delete(entity.kind);
    }
  }

  get(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  list(filter?: { kind?: EntityKind; subKind?: string }): Entity[] {
    if (!filter || (!filter.kind && !filter.subKind)) {
      return [...this.entities.values()];
    }
    const out: Entity[] = [];
    const ids = filter.kind ? this.byKind.get(filter.kind) ?? new Set<string>() : null;
    const source = ids
      ? Array.from(ids).map((id) => this.entities.get(id)!).filter(Boolean)
      : Array.from(this.entities.values());
    for (const e of source) {
      if (filter.subKind && e.subKind !== filter.subKind) continue;
      out.push(e);
    }
    return out;
  }

  values(): IterableIterator<Entity> {
    return this.entities.values();
  }

  get size(): number {
    return this.entities.size;
  }

  clear(): void {
    this.entities.clear();
    this.byKind.clear();
  }
}

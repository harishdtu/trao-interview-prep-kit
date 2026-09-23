import { randomUUID } from "crypto";
import {
  UserRepository,
  UserRecord,
  KitRepository,
  KitRecord,
  PracticeRepository,
  PracticeStateRecord,
  Repositories,
} from "./repository";

export class InMemoryUserRepository implements UserRepository {
  private byId = new Map<string, UserRecord>();
  private byEmail = new Map<string, string>();

  async create(user: Omit<UserRecord, "id" | "createdAt">): Promise<UserRecord> {
    const id = randomUUID();
    const record: UserRecord = { ...user, id, createdAt: new Date().toISOString() };
    this.byId.set(id, record);
    this.byEmail.set(user.email.toLowerCase(), id);
    return record;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const id = this.byEmail.get(email.toLowerCase());
    return id ? this.byId.get(id) ?? null : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }
}

export class InMemoryKitRepository implements KitRepository {
  private byId = new Map<string, KitRecord>();

  async create(kit: Omit<KitRecord, "id" | "createdAt" | "updatedAt">): Promise<KitRecord> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const record: KitRecord = { ...kit, id, createdAt: now, updatedAt: now };
    this.byId.set(id, record);
    return record;
  }

  async update(id: string, patch: Partial<KitRecord>): Promise<KitRecord | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;
    const updated: KitRecord = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.byId.set(id, updated);
    return updated;
  }

  async findById(id: string): Promise<KitRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByOwner(ownerId: string): Promise<KitRecord[]> {
    return Array.from(this.byId.values()).filter((k) => k.ownerId === ownerId);
  }

  async findByOwnerAndInputHash(ownerId: string, inputHash: string): Promise<KitRecord | null> {
    return (
      Array.from(this.byId.values()).find(
        (k) => k.ownerId === ownerId && k.inputHash === inputHash
      ) ?? null
    );
  }

  async delete(id: string): Promise<boolean> {
    return this.byId.delete(id);
  }
}

export class InMemoryPracticeRepository implements PracticeRepository {
  private byId = new Map<string, PracticeStateRecord>();
  private byKit = new Map<string, string>();

  async getOrCreate(ownerId: string, kitId: string): Promise<PracticeStateRecord> {
    const existingId = this.byKit.get(kitId);
    if (existingId) return this.byId.get(existingId)!;
    const id = randomUUID();
    const record: PracticeStateRecord = {
      id,
      ownerId,
      kitId,
      cards: {},
      updatedAt: new Date().toISOString(),
    };
    this.byId.set(id, record);
    this.byKit.set(kitId, id);
    return record;
  }

  async update(id: string, patch: Partial<PracticeStateRecord>): Promise<PracticeStateRecord | null> {
    const existing = this.byId.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.byId.set(id, updated);
    return updated;
  }
}

export function createInMemoryRepositories(): Repositories {
  return {
    users: new InMemoryUserRepository(),
    kits: new InMemoryKitRepository(),
    practice: new InMemoryPracticeRepository(),
  };
}

import { UserModel, KitModel, PracticeStateModel } from "./models";
import {
  UserRepository,
  UserRecord,
  KitRepository,
  KitRecord,
  PracticeRepository,
  PracticeStateRecord,
  Repositories,
} from "./repository";

function userDocToRecord(doc: any): UserRecord {
  return {
    id: doc._id.toString(),
    email: doc.email,
    passwordHash: doc.passwordHash,
    createdAt: doc.createdAt.toISOString(),
  };
}

function kitDocToRecord(doc: any): KitRecord {
  return {
    id: doc._id.toString(),
    ownerId: doc.ownerId,
    status: doc.status,
    input: doc.input,
    inputHash: doc.inputHash,
    kit: doc.kit ?? null,
    questionMeta: doc.questionMeta ?? {},
    flashcardMeta: doc.flashcardMeta ?? {},
    companyBriefMeta: doc.companyBriefMeta ?? { origin: "generated", edited: false },
    generationError: doc.generationError ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

function practiceDocToRecord(doc: any): PracticeStateRecord {
  return {
    id: doc._id.toString(),
    ownerId: doc.ownerId,
    kitId: doc.kitId,
    cards: doc.cards ?? {},
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export class MongoUserRepository implements UserRepository {
  async create(user: Omit<UserRecord, "id" | "createdAt">): Promise<UserRecord> {
    const doc = await UserModel.create(user);
    return userDocToRecord(doc);
  }
  async findByEmail(email: string): Promise<UserRecord | null> {
    const doc = await UserModel.findOne({ email: email.toLowerCase() });
    return doc ? userDocToRecord(doc) : null;
  }
  async findById(id: string): Promise<UserRecord | null> {
    const doc = await UserModel.findById(id).catch(() => null);
    return doc ? userDocToRecord(doc) : null;
  }
}

export class MongoKitRepository implements KitRepository {
  async create(kit: Omit<KitRecord, "id" | "createdAt" | "updatedAt">): Promise<KitRecord> {
    const doc = await KitModel.create(kit);
    return kitDocToRecord(doc);
  }
  async update(id: string, patch: Partial<KitRecord>): Promise<KitRecord | null> {
    const doc = await KitModel.findByIdAndUpdate(id, patch, { new: true }).catch(() => null);
    return doc ? kitDocToRecord(doc) : null;
  }
  async findById(id: string): Promise<KitRecord | null> {
    const doc = await KitModel.findById(id).catch(() => null);
    return doc ? kitDocToRecord(doc) : null;
  }
  async findByOwner(ownerId: string): Promise<KitRecord[]> {
    const docs = await KitModel.find({ ownerId }).sort({ createdAt: -1 });
    return docs.map(kitDocToRecord);
  }
  async findByOwnerAndInputHash(ownerId: string, inputHash: string): Promise<KitRecord | null> {
    const doc = await KitModel.findOne({ ownerId, inputHash });
    return doc ? kitDocToRecord(doc) : null;
  }
  async delete(id: string): Promise<boolean> {
    const res = await KitModel.findByIdAndDelete(id).catch(() => null);
    return !!res;
  }
}

export class MongoPracticeRepository implements PracticeRepository {
  async getOrCreate(ownerId: string, kitId: string): Promise<PracticeStateRecord> {
    const existing = await PracticeStateModel.findOne({ kitId });
    if (existing) return practiceDocToRecord(existing);
    const doc = await PracticeStateModel.create({ ownerId, kitId, cards: {} });
    return practiceDocToRecord(doc);
  }
  async update(id: string, patch: Partial<PracticeStateRecord>): Promise<PracticeStateRecord | null> {
    const doc = await PracticeStateModel.findByIdAndUpdate(id, patch, { new: true }).catch(() => null);
    return doc ? practiceDocToRecord(doc) : null;
  }
}

export function createMongoRepositories(): Repositories {
  return {
    users: new MongoUserRepository(),
    kits: new MongoKitRepository(),
    practice: new MongoPracticeRepository(),
  };
}

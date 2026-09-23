import { Kit } from "../validation/kitSchema";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export type EditableQuestion = Kit["questions"][number] & {
  origin: "generated" | "user";
  edited: boolean;
  pinned: boolean;
};

export type EditableFlashcard = Kit["flashcards"][number] & {
  origin: "generated" | "user";
  edited: boolean;
  pinned: boolean;
};

export interface KitRecord {
  id: string;
  ownerId: string;
  status: "draft" | "generating" | "ready" | "failed";
  input: { jd: string; company_url: string; days: number };
  inputHash: string;
  kit: Kit | null;
  // question/flashcard editable-state metadata is stored alongside the
  // canonical kit fields, keyed by id, so regeneration merges can consult
  // it without changing the persisted Appendix-A kit shape itself.
  questionMeta: Record<string, { origin: "generated" | "user"; edited: boolean; pinned: boolean }>;
  flashcardMeta: Record<string, { origin: "generated" | "user"; edited: boolean; pinned: boolean }>;
  companyBriefMeta: { origin: "generated" | "user"; edited: boolean };
  generationError: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PracticeCardState {
  flashcardId: string;
  confidence: 1 | 2 | 3 | null;
  timesReviewed: number;
  lastReviewedAt: string | null;
}

export interface PracticeStateRecord {
  id: string;
  ownerId: string;
  kitId: string;
  cards: Record<string, PracticeCardState>;
  updatedAt: string;
}

export interface UserRepository {
  create(user: Omit<UserRecord, "id" | "createdAt">): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface KitRepository {
  create(kit: Omit<KitRecord, "id" | "createdAt" | "updatedAt">): Promise<KitRecord>;
  update(id: string, patch: Partial<KitRecord>): Promise<KitRecord | null>;
  findById(id: string): Promise<KitRecord | null>;
  findByOwner(ownerId: string): Promise<KitRecord[]>;
  findByOwnerAndInputHash(ownerId: string, inputHash: string): Promise<KitRecord | null>;
  delete(id: string): Promise<boolean>;
}

export interface PracticeRepository {
  getOrCreate(ownerId: string, kitId: string): Promise<PracticeStateRecord>;
  update(id: string, patch: Partial<PracticeStateRecord>): Promise<PracticeStateRecord | null>;
}

export interface Repositories {
  users: UserRepository;
  kits: KitRepository;
  practice: PracticeRepository;
}

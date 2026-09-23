import { Schema, model, models, Document } from "mongoose";

export interface UserDoc extends Document {
  email: string;
  passwordHash: string;
  createdAt: Date;
}
const UserSchema = new Schema<UserDoc>({
  email: { type: String, required: true, unique: true, lowercase: true, index: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
});
export const UserModel = models.User || model<UserDoc>("User", UserSchema);

export interface KitDoc extends Document {
  ownerId: string;
  status: "draft" | "generating" | "ready" | "failed";
  input: { jd: string; company_url: string; days: number };
  inputHash: string;
  kit: unknown;
  questionMeta: Record<string, { origin: string; edited: boolean; pinned: boolean }>;
  flashcardMeta: Record<string, { origin: string; edited: boolean; pinned: boolean }>;
  companyBriefMeta: { origin: string; edited: boolean };
  generationError: { code: string; message: string } | null;
  createdAt: Date;
  updatedAt: Date;
}
const KitSchemaMongo = new Schema<KitDoc>(
  {
    ownerId: { type: String, required: true, index: true },
    status: { type: String, required: true, default: "draft" },
    input: {
      jd: String,
      company_url: String,
      days: Number,
    },
    inputHash: { type: String, index: true },
    kit: { type: Schema.Types.Mixed, default: null },
    questionMeta: { type: Schema.Types.Mixed, default: {} },
    flashcardMeta: { type: Schema.Types.Mixed, default: {} },
    companyBriefMeta: { type: Schema.Types.Mixed, default: { origin: "generated", edited: false } },
    generationError: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);
export const KitModel = models.Kit || model<KitDoc>("Kit", KitSchemaMongo);

export interface PracticeStateDoc extends Document {
  ownerId: string;
  kitId: string;
  cards: Record<string, { flashcardId: string; confidence: number | null; timesReviewed: number; lastReviewedAt: string | null }>;
  updatedAt: Date;
}
const PracticeStateSchema = new Schema<PracticeStateDoc>(
  {
    ownerId: { type: String, required: true, index: true },
    kitId: { type: String, required: true, index: true },
    cards: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);
export const PracticeStateModel =
  models.PracticeState || model<PracticeStateDoc>("PracticeState", PracticeStateSchema);

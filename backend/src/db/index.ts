import mongoose from "mongoose";
import { env } from "../config/env";
import { Repositories } from "./repository";
import { createInMemoryRepositories } from "./memoryRepository";
import { createMongoRepositories } from "./mongoRepository";

let cachedRepositories: Repositories | null = null;
let usingMongo = false;

export function isUsingMongo(): boolean {
  return usingMongo;
}

/**
 * Attempts to connect to MongoDB using MONGODB_URI (supports both Atlas
 * `mongodb+srv://` and local `mongodb://` connection strings — mongoose
 * handles both transparently). If the connection cannot be established
 * within a short timeout, falls back to an in-memory repository set so
 * the rest of the application can still start and be developed/tested
 * without a live database.
 */
export async function initRepositories(): Promise<Repositories> {
  if (cachedRepositories) return cachedRepositories;

  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 2000,
    });
    usingMongo = true;
    cachedRepositories = createMongoRepositories();
    // eslint-disable-next-line no-console
    console.log(`[db] connected to MongoDB`);
  } catch (err) {
    usingMongo = false;
    cachedRepositories = createInMemoryRepositories();
    // eslint-disable-next-line no-console
    console.warn(
      `[db] could not connect to MongoDB (${
        err instanceof Error ? err.message : String(err)
      }) — falling back to in-memory repositories. Data will not persist across restarts.`
    );
  }

  return cachedRepositories;
}

export async function closeRepositories(): Promise<void> {
  if (usingMongo) {
    await mongoose.disconnect();
  }
  cachedRepositories = null;
}

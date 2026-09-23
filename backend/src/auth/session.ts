import session from "express-session";
import MongoStore from "connect-mongo";
import { env } from "../config/env";
import { isUsingMongo } from "../db";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export function buildSessionMiddleware() {
  const store =
    isUsingMongo() && env.NODE_ENV === "production"
      ? MongoStore.create({ mongoUrl: env.MONGODB_URI, touchAfter: 60 * 60 })
      : undefined; // falls back to express-session's built-in MemoryStore (fine for dev/tests)

  return session({
    name: "trao.sid",
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_MS,
    },
  });
}

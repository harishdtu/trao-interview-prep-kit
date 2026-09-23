import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: parseInt(process.env.PORT ?? "4000", 10),
  MONGODB_URI: process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/trao",
  SESSION_SECRET: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? "",
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-1.5-flash",
  ALLOW_PRIVATE_FETCHES: process.env.ALLOW_PRIVATE_FETCHES === "true",
  MAX_PAGES: parseInt(process.env.MAX_PAGES ?? "8", 10),
  MAX_COVERAGE_PASSES: parseInt(process.env.MAX_COVERAGE_PASSES ?? "2", 10),
  CRAWL_CONCURRENCY: parseInt(process.env.CRAWL_CONCURRENCY ?? "2", 10),
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
};

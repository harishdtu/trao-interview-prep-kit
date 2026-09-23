import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { ZodError } from "zod";
import { Repositories } from "./db/repository";
import { buildSessionMiddleware } from "./auth/session";
import { buildAuthRouter } from "./auth/routes";
import { buildKitsRouter } from "./kits/routes";
import { LLMProvider } from "./llm/LLMProvider";
import { env } from "./config/env";

export function buildApp(repos: Repositories, llm: LLMProvider): Express {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors({ origin: env.FRONTEND_ORIGIN, credentials: true }));
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(buildSessionMiddleware());

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use("/auth", buildAuthRouter(repos));
  app.use("/api/kits", buildKitsRouter(repos, llm));

  // 404
  app.use((_req, res) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
  });

  // Structured error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error(err);

    // A ZodError reaching here means a mutation produced a kit that failed
    // schema validation (e.g. a malformed PATCH body) — that's a client
    // input problem, not a server fault, and its raw internals (full
    // schema/union dump) should never be echoed back to the caller.
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "The request produced an invalid kit and was rejected." },
      });
    }

    const status = err?.status ?? 500;
    res.status(status).json({
      error: {
        code: err?.code ?? "INTERNAL_ERROR",
        message: status >= 500 ? "Something went wrong." : err?.message ?? "Something went wrong.",
      },
    });
  });

  return app;
}

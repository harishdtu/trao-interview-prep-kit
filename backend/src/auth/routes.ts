import { Router } from "express";
import { z } from "zod";
import { Repositories } from "../db/repository";
import { hashPassword, verifyPassword } from "./hash";

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export function buildAuthRouter(repos: Repositories): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "Invalid input." },
      });
    }
    const { email, password } = parsed.data;

    const existing = await repos.users.findByEmail(email);
    if (existing) {
      return res.status(409).json({
        error: { code: "EMAIL_TAKEN", message: "An account with that email already exists." },
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await repos.users.create({ email, passwordHash });

    req.session.userId = user.id;
    return res.status(201).json({ user: { id: user.id, email: user.email } });
  });

  router.post("/login", async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "Email and password are required." },
      });
    }
    const { email, password } = parsed.data;

    const user = await repos.users.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
      });
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." },
      });
    }

    req.session.userId = user.id;
    return res.json({ user: { id: user.id, email: user.email } });
  });

  router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: { code: "LOGOUT_FAILED", message: "Could not log out." } });
      }
      res.clearCookie("trao.sid");
      return res.status(204).send();
    });
  });

  router.get("/me", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Not logged in." } });
    }
    const user = await repos.users.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Session invalid." } });
    }
    return res.json({ user: { id: user.id, email: user.email } });
  });

  return router;
}

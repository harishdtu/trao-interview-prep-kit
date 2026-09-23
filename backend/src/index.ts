import { env } from "./config/env";
import { initRepositories } from "./db";
import { buildApp } from "./app";
import { GeminiProvider } from "./llm/GeminiProvider";
import { LLMProvider } from "./llm/LLMProvider";

async function main() {
  const repos = await initRepositories();

  let llm: LLMProvider;
  if (env.GEMINI_API_KEY) {
    llm = new GeminiProvider(env.GEMINI_API_KEY, env.GEMINI_MODEL);
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      "[startup] GEMINI_API_KEY is not set — kit generation endpoints will fail until it is configured."
    );
    llm = new GeminiProvider("placeholder-until-configured", env.GEMINI_MODEL);
  }

  const app = buildApp(repos, llm);
  app.listen(env.PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on port ${env.PORT} (env: ${env.NODE_ENV})`);
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[startup] fatal error:", err);
  process.exit(1);
});

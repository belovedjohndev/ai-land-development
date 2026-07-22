import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@ald/database";
import { z } from "zod";
import { buildApp } from "./app.js";
import { PostgresApplicationRepository } from "./repositories/postgres-application-repository.js";
import { PostgresSessionRepository } from "./repositories/postgres-session-repository.js";
import { Argon2idPasswordHasher } from "./security/argon2id-password-hasher.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const databaseUrl = process.env.DATABASE_URL;
const sessionTtlHours = z.coerce
  .number()
  .int()
  .positive()
  .max(168)
  .parse(process.env.SESSION_TTL_HOURS ?? "12");

if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const { db, client } = createDatabase(databaseUrl);
const app = await buildApp({
  repository: new PostgresApplicationRepository(db),
  sessionRepository: new PostgresSessionRepository(db),
  passwordHasher: new Argon2idPasswordHasher(),
  sessionTtlMs: sessionTtlHours * 60 * 60 * 1_000,
  secureCookies: process.env.NODE_ENV === "production",
});

app.addHook("onClose", async () => {
  await client.end();
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@ald/database";
import { z } from "zod";
import { buildApp } from "./app.js";
import { S3ObjectStorage } from "./documents/s3-object-storage.js";
import { PostgresApplicationRepository } from "./repositories/postgres-application-repository.js";
import { PostgresDocumentRepository } from "./repositories/postgres-document-repository.js";
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
const storageConfig = z
  .object({
    endpoint: z.string().url().optional(),
    region: z.string().trim().min(1),
    bucket: z.string().trim().min(1),
    accessKeyId: z.string().min(1).optional(),
    secretAccessKey: z.string().min(1).optional(),
    forcePathStyle: z
      .enum(["true", "false"])
      .transform((value) => (value === "true" ? true : false)),
  })
  .refine(
    (value) => Boolean(value.accessKeyId) === Boolean(value.secretAccessKey),
    { message: "Storage access key and secret key must be provided together." },
  )
  .parse({
    endpoint: process.env.STORAGE_ENDPOINT,
    region: process.env.STORAGE_REGION ?? "us-east-1",
    bucket: process.env.STORAGE_BUCKET,
    accessKeyId: process.env.STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.STORAGE_SECRET_KEY,
    forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE ?? "false",
  });

if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const { db, client } = createDatabase(databaseUrl);
const documentRepository = new PostgresDocumentRepository(db);
const app = await buildApp({
  repository: new PostgresApplicationRepository(db),
  documentRepository,
  objectStorage: new S3ObjectStorage(storageConfig),
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

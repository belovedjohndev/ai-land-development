import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@ald/database";
import { buildApp } from "./app.js";
import { PostgresApplicationRepository } from "./repositories/postgres-application-repository.js";

config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

const databaseUrl = process.env.DATABASE_URL;
const tenantId = process.env.DEV_TENANT_ID;
const actorId = process.env.DEV_REVIEWER_ID;

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!tenantId)
  throw new Error(
    "DEV_TENANT_ID is required until authentication is implemented.",
  );
if (!actorId)
  throw new Error(
    "DEV_REVIEWER_ID is required until authentication is implemented.",
  );

const { db, client } = createDatabase(databaseUrl);
const app = await buildApp({
  repository: new PostgresApplicationRepository(db),
  requestContext: { tenantId, actorId },
});

app.addHook("onClose", async () => {
  await client.end();
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });

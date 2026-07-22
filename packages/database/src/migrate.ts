import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { requireDatabaseUrl } from "./env.js";

const migrationsDirectory = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);
const client = postgres(requireDatabaseUrl(), { max: 1 });

try {
  await client.unsafe("CREATE SCHEMA IF NOT EXISTS drizzle");
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL UNIQUE,
      created_at bigint NOT NULL
    )
  `);

  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right));

  const appliedRows = await client<{ hash: string }[]>`
    SELECT hash FROM drizzle.__drizzle_migrations
  `;
  const applied = new Set(appliedRows.map((row) => row.hash));

  for (const file of files) {
    const sql = await readFile(`${migrationsDirectory}/${file}`, "utf8");
    const normalizedSql = sql.replaceAll("\r\n", "\n");
    const hash = createHash("sha256").update(normalizedSql).digest("hex");
    const lineEndingHashes = [
      hash,
      createHash("sha256").update(sql).digest("hex"),
      createHash("sha256")
        .update(normalizedSql.replaceAll("\n", "\r\n"))
        .digest("hex"),
    ];

    if (lineEndingHashes.some((candidate) => applied.has(candidate))) {
      console.log(`Already applied: ${file}`);
      continue;
    }

    await client.begin(async (transaction) => {
      await transaction.unsafe(sql);
      await transaction`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${Date.now()})
      `;
    });

    console.log(`Applied: ${file}`);
  }
} finally {
  await client.end();
}

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = path.join(import.meta.dirname, "../../migrations");

// Any fixed number works; it only has to be the same for every process that migrates.
const MIGRATION_LOCK_ID = 727274;

function checksum(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");
}

// Applies every migration that hasn't run yet and returns their names.
// Used by the `pnpm db:migrate` command and by the test setup.
export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const applied = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const appliedByName = new Map(applied.rows.map((row) => [row.name, row.checksum]));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    const newlyApplied: string[] = [];

    for (const file of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const hash = checksum(sql);
      const previousHash = appliedByName.get(file);

      if (previousHash !== undefined) {
        if (previousHash !== hash) {
          throw new Error(
            `Migration ${file} was changed after it was applied. Add a new migration instead.`,
          );
        }
        continue;
      }

      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          file,
          hash,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      newlyApplied.push(file);
    }

    return newlyApplied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}
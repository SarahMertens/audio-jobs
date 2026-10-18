import { runMigrations } from "./migrations.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set. Did you create the .env file?");
  process.exit(1);
}

try {
  const applied = await runMigrations(databaseUrl);
  for (const name of applied) console.log(`applied ${name}`);
  console.log(applied.length === 0 ? "database is up to date" : `${applied.length} migration(s) applied`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
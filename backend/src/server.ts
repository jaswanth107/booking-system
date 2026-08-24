import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/index.js";
import { seedDefaultResources } from "./db/seedResources.js";
import { createApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "..", "data.sqlite");
const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? "0.0.0.0";

const db = openDatabase(DB_PATH);

// Idempotent: safe to run on every boot (e.g. a fresh disk on first deploy).
// A separate manual seed step isn't available on most PaaS hosts.
const inserted = seedDefaultResources(db);
if (inserted > 0) console.log(`Seeded ${inserted} default resources.`);

const app = createApp(db);

app.listen(PORT, HOST, () => {
  console.log(`Booking API listening on http://${HOST}:${PORT} (db: ${DB_PATH})`);
});

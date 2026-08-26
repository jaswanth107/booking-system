import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/index.js";
import { seedDefaultResources } from "./db/seedResources.js";
import { ensureDefaultAdmin } from "./services/authService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "..", "data.sqlite");

async function main() {
  const db = openDatabase(DB_PATH);

  // Regular users sign up for real accounts (name/email/password) through
  // the app, so seeding only covers resources + the default admin here.
  const inserted = seedDefaultResources(db);
  console.log(inserted > 0 ? `Seeded ${inserted} resources.` : "Resources already seeded.");
  await ensureDefaultAdmin(db);

  db.close();
}

main();

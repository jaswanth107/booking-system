import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db/index.js";
import { seedDefaultResources } from "./db/seedResources.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH ?? path.join(__dirname, "..", "data.sqlite");

const db = openDatabase(DB_PATH);

// Users now sign up for real accounts (name/email/password) through the app,
// so seeding only covers resources here.
const inserted = seedDefaultResources(db);
console.log(inserted > 0 ? `Seeded ${inserted} resources.` : "Resources already seeded.");

db.close();

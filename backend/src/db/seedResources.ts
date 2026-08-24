import type { DatabaseSync } from "node:sqlite";
import { v4 as uuidv4 } from "uuid";

/** Idempotent: only inserts the default rooms if the resources table is empty. */
export function seedDefaultResources(db: DatabaseSync): number {
  const resourceCount = (db.prepare("SELECT COUNT(*) as c FROM resources").get() as { c: number }).c;
  if (resourceCount > 0) return 0;

  const now = new Date().toISOString();
  const resources = [
    { id: uuidv4(), name: "Falcon Room", description: "Small meeting room with a whiteboard.", location: "Floor 2, East Wing", capacity: 4 },
    { id: uuidv4(), name: "Orion Room", description: "Large conference room with video conferencing.", location: "Floor 3, North Wing", capacity: 12 },
    { id: uuidv4(), name: "Comet Pod", description: "Quiet focus pod for 1-2 people.", location: "Floor 1, Library", capacity: 2 },
    { id: uuidv4(), name: "Nebula Hall", description: "Large event space for workshops.", location: "Ground Floor", capacity: 40 }
  ];
  const insertResource = db.prepare(
    "INSERT INTO resources (id, name, description, location, capacity, createdAt) VALUES (@id, @name, @description, @location, @capacity, @createdAt)"
  );
  for (const r of resources) insertResource.run({ ...r, createdAt: now });
  return resources.length;
}

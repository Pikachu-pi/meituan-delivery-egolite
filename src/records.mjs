import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function writeRecord(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n", "utf8");
  await fs.rename(temporary, file);
}

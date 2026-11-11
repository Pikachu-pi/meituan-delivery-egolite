import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const claimRoot = path.join(homedir(), ".meituan-delivery-egolite", "active");

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    if (error.code === "EPERM") return true;
    throw error;
  }
}

export async function withClaim(kind, id, action, root = claimRoot) {
  const key = createHash("sha256").update(id).digest("hex");
  const dir = path.join(root, kind + "-" + key);
  const own = process.pid + "-" + randomUUID();
  const file = path.join(dir, own);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, "", { flag: "wx" });
  try {
    // Publish before checking. A later contender always sees an active owner.
    for (const entry of await fs.readdir(dir)) {
      const match = /^(\d+)-[0-9a-f-]{36}$/.exec(entry);
      if (!match || entry === own) continue;
      if (isRunning(Number(match[1]))) {
        const error = new Error(kind === "profile" ? "这个 Ego 资料正在处理另一项任务，等它完成再试。" : "这个美团账号正在处理另一项任务，等它完成再试。");
        error.code = "busy";
        throw error;
      }
      await fs.rm(path.join(dir, entry), { force: true });
    }
    return await action();
  } finally {
    await fs.rm(file, { force: true });
  }
}

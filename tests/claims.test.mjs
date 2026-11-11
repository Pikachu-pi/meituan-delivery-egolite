import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { withClaim } from "../src/claims.mjs";

test("另一进程占用的资料不能切店，退出后可以继续", async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "delivery-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const moduleUrl = new URL("../src/claims.mjs", import.meta.url).href;
  const code = `import {withClaim} from ${JSON.stringify(moduleUrl)};
    await withClaim("profile", "shared", () => new Promise(() => {
      console.log("ready");
      setInterval(() => {}, 1000);
    }), process.argv[1]);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code, root], {
    stdio: ["ignore", "pipe", "inherit"], windowsHide: true,
  });
  const exited = once(child, "exit");
  try {
    assert.match(String(await Promise.race([
      once(child.stdout, "data").then(([chunk]) => chunk),
      exited.then(() => { throw new Error("测试进程未取得资料"); }),
    ])), /ready/);
    await assert.rejects(withClaim("profile", "shared", () => assert.fail("不应运行"), root), { code: "busy" });
    await withClaim("profile", "other", () => {}, root);
  } finally {
    child.kill();
    await exited;
  }
  assert.equal(await withClaim("profile", "shared", () => "released", root), "released");
});

test("不同资料和账号可同时处理，同账号下的另一个资料被拒绝", async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), "delivery-lock-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const run = (profile, account, action) =>
    withClaim("profile", profile, () => withClaim("account", account, action, root), root);
  await run("first", "account-a", async () => {
    assert.equal(await run("second", "account-b", () => "parallel"), "parallel");
    await assert.rejects(run("second", "account-a", () => assert.fail("不应运行")), { code: "busy" });
  });
  await run("second", "account-a", () => {});
});

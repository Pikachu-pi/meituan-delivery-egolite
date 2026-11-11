import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { writeRecord } from "./src/records.mjs";
import { onboardingGuide } from "./src/onboarding-guide.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const [command, id, fileOrSpace, resumeSpace] = process.argv.slice(2);
const usage = `美团配送设置

  node cli.mjs profiles                          查看 Ego 资料
  node cli.mjs guide <步骤> [参数]               输出该步骤的固定提示
  node cli.mjs onboard <中台键> [空间ID]          打开登录页或按名单只读核对
  node cli.mjs inspect <门店ID> [空间ID]          只读核对并保存门店档案
  node cli.mjs apply <门店ID> <任务.json> [空间ID]  调整一家门店
  node cli.mjs batch <任务.json>                  批量调整

首次使用见 README.md。登录后用返回的空间 ID 继续。结果待核实时先用 inspect 查看实际设置。`;
const isId = value => /^\d+$/.test(value ?? "");
const optionalId = value => value === undefined || isId(value);
const valid = {
  profiles: id === undefined,
  onboard: Boolean(id) && optionalId(fileOrSpace) && resumeSpace === undefined,
  inspect: isId(id) && optionalId(fileOrSpace) && resumeSpace === undefined,
  apply: isId(id) && Boolean(fileOrSpace) && optionalId(resumeSpace),
  batch: Boolean(id) && fileOrSpace === undefined,
};

if (!command || command === "--help" || command === "-h") {
  console.log(usage);
} else if (command === "guide") {
  try {
    console.log(onboardingGuide(id, process.argv.slice(4)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
} else if (!Object.hasOwn(valid, command) || !valid[command] || process.argv.length > 6) {
  console.error(usage);
  process.exitCode = 1;
} else {
  const request = {
    command, id,
    jobFile: command === "apply" ? path.resolve(fileOrSpace) : command === "batch" ? path.resolve(id) : null,
    spaceId: command === "apply" ? resumeSpace : fileOrSpace,
    runId: new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID().slice(0, 8),
  };
  const requestFile = path.join(root, ".local", "requests", request.runId + ".json");
  request.resultFile = path.join(root, ".local", "requests", request.runId + ".result.json");
  await writeRecord(requestFile, request);
  try {
    const runner = new URL("./src/ego-runner.mjs", import.meta.url);
    runner.searchParams.set("request", pathToFileURL(requestFile).href);
    const specifier = runner.href.replace(/'/g, "%27");
    const result = spawnSync("ego-browser", ["nodejs", "-e", "await import('" + specifier + "')"], {
      stdio: "inherit", windowsHide: true,
    });
    if (result.error?.code === "ENOENT") {
      throw new Error("找不到 ego-browser。打开 Ego Lite 完成首次设置，再用新终端运行 ego-browser --version。");
    }
    if (result.error) throw result.error;
    const output = await fs.readFile(request.resultFile, "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (output) process.stdout.write(output);
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await Promise.all([requestFile, request.resultFile].map(file => fs.rm(file, { force: true })));
  }
}

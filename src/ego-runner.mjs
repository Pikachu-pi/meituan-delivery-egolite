import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enterStore, merchantIdentity, openOverview, openSettings, readBlockingPopup, readPage, samePrices } from "./ego-page.mjs";
import { compareRangeLists, compileJob } from "./job.mjs";
import { setMinimumPeriod, setBaseFee } from "./adjust.mjs";
import { manualPeriod, readPeriodControls, setPeriodEnabled } from "./special.mjs";
import { writeRecord } from "./records.mjs";
import { withClaim } from "./claims.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const local = path.join(root, ".local");
const requestUrl = new URL(import.meta.url).searchParams.get("request");
const configFile = path.join(local, "stores.json");

async function readJson(file, description) {
  const text = await fs.readFile(file, "utf8").catch(error => {
    if (error.code === "ENOENT") throw new Error("找不到" + description + "。请查看 README.md。");
    throw error;
  });
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error(description + "不是有效的 JSON。请参照 examples/ 中的示例。");
  }
}

async function scan(page, store, job) {
  await openOverview(page);
  const controls = await readPeriodControls(page, store);
  const fields = job?.periods?.some(period => period.minOrder !== undefined)
    ? ["baseFee", "minOrder"] : ["minOrder", "baseFee"];
  const reads = {};
  for (const field of fields) {
    await openSettings(page, field);
    reads[field] = await readPage(page, store);
  }
  const { minOrder: minimum, baseFee: fee } = reads;
  compareRangeLists(minimum, fee);
  return { version: 1, observedAt: new Date().toISOString(), store, controls, minimum, fee };
}

async function findStore(config, id, applying) {
  const registered = config.stores.filter(item => item.id === id);
  if (registered.length !== 1) throw new Error("门店 ID 未登记或重复 " + id + "。请检查 .local/stores.json。");
  const store = { ...registered[0] };
  const platform = config.platforms[store.platform];
  if (!store.name?.trim()) throw new Error("门店缺少名称 " + id);
  if (typeof platform?.profileId !== "string" || !platform.profileId.trim()) {
    throw new Error("请先运行 profiles，登记该中台的 Ego 资料 ID。");
  }
  const profileFile = path.join(local, "store-profiles", store.id + ".json");
  const archive = await fs.readFile(profileFile, "utf8").then(JSON.parse).catch(error => {
    if (error.code === "ENOENT") return {};
    throw error;
  });
  const archivedAccount = archive.workflow?.profileId === platform.profileId && archive.store?.id === id
    && archive.store.name === store.name && archive.store.platform === store.platform && archive.store.account;
  store.account = platform.account || archivedAccount || undefined;
  if (applying && (!archivedAccount || archivedAccount !== store.account)) {
    throw new Error("请先运行 inspect " + id + "，在登记的 Ego 资料完成只读核对。");
  }
  return { store, platform, profileFile, archive };
}

export async function applyPrices({ page, store, plan, before, dir, summary, addStep }) {
  const expected = { minOrder: before.minimum, baseFee: before.fee };
  for (const field of ["minOrder", "baseFee"]) {
    const observed = [];
    for (const item of plan) {
      const args = { page, store, periodTitle: item.title, freshRead: false };
      const actions = field === "minOrder"
        ? (item.minimumValues ? [file => setMinimumPeriod({ ...args, values: item.minimumValues, ranges: item.minimumRanges, recordFile: file, expectedBefore: expected[field] })] : [])
        : item.fees.map(fee => file => setBaseFee({ ...args, ...fee, recordFile: file, expectedBefore: expected[field] }));
      for (const action of actions) {
        const step = await addStep(action);
        expected[field] = step.record.after;
        if (step.record.status === "observed") observed.push(step);
      }
    }
    if (!observed.length) continue;
    const checking = performance.now();
    let actual;
    try {
      await openSettings(page, field, { fresh: true });
      actual = await readPage(page, store);
    } finally {
      summary.readbackMs += Math.round(performance.now() - checking);
    }
    const readbackFile = path.join(dir, field + "-readback.json");
    await writeRecord(readbackFile, actual);
    summary.readbackFiles[field] = readbackFile;
    if (!samePrices(actual, expected[field])) throw new Error("完整回读与本次保存后的配置不符 " + field);
    expected[field] = actual;
    for (const { record, entry } of observed) {
      record.status = "verified";
      record.verifiedReadAt = actual.readAt;
      await writeRecord(entry.recordFile, record);
      entry.status = "verified";
    }
  }
  await writeRecord(path.join(dir, "after-prices.json"), expected);
}

function runStore(entry) {
  const { store, platform } = entry;
  return withClaim("profile", platform.profileId, () =>
    store.account
      ? withClaim("account", store.account, () => openStore(entry))
      : openStore(entry));
}

async function openStore(entry) {
  const { store, platform, spaceId, runId, onboarding } = entry;
  const started = performance.now();
  const startedAt = new Date().toISOString();
  const prior = spaceId && (await listTaskSpaces()).find(item => item.id === Number(spaceId));
  if (spaceId && prior?.profileId !== platform.profileId) throw new Error("续用空间未绑定登记资料");
  const task = prior
    ? (prior.ownership === "agent" ? await taskSpace(prior.id) : await takeOverTaskSpace(prior.id))
    : await taskSpace(onboarding ? "美团登录 · " + (platform.name || store.platform) + " · " + store.id + " " + runId
      : "美团配送 " + store.id + " " + runId, { profileId: platform.profileId });
  const taskInfo = (await listTaskSpaces()).find(item => item.id === task.spaceId);
  if (taskInfo?.profileId !== platform.profileId) throw new Error("此 Ego 空间未绑定登记资料");
  let page = task.page("p1");
  if (prior && prior.ownership !== "agent") {
    const active = task.userPage();
    if (active) page = active.label ? active : await task.adopt(active);
  }
  // The selected store is shared across spaces. Start at the merchant home before selecting it.
  await page.goto("https://shangoue.meituan.com/", { waitUntil: "commit", timeout: 15000 });
  try {
    await page.waitForSelector(".acctinfo-container .txt", { state: "visible", timeout: 10000 });
  } catch {
    const login = new URL(await page.url()).pathname.includes("login");
    if (!login) throw new Error("商家页面未加载，请检查 Ego Lite 中的美团页面后再试。");
    await task.handOff();
    return { status: "login_required", storeId: store.id, spaceId: task.spaceId, platform: platform.name,
      message: "请在 Ego 窗口完成美团登录，然后继续核对。", startedAt, finishedAt: new Date().toISOString() };
  }
  const identity = await merchantIdentity(page);
  const runSelected = async () => {
    try {
      return await runSelectedStore({ ...entry, task, page, started, startedAt });
    } catch (error) {
      const popup = await readBlockingPopup(page).catch(() => undefined);
      if (!popup) throw error;
      return { status: "needs_check", storeId: store.id, spaceId: task.spaceId, popup, error: error.message };
    }
  };
  if (!store.account) {
    if (!identity.account) throw new Error("未读到美团登录账号，请先完成登录。");
    store.account = identity.account;
    return withClaim("account", store.account, runSelected);
  }
  return runSelected();
}

async function runSelectedStore({ store, platform, profileFile, archive, job, dir, task, page, started, startedAt }) {
  await enterStore(page, store);
  const selected = performance.now();
  const before = await scan(page, store, job);
  const scanMs = Math.round(performance.now() - selected);
  const selectMs = Math.round(selected - started);
  if (!job) {
    await writeRecord(profileFile, { ...before, workflow: { profileId: platform.profileId },
      notes: archive.notes || [] });
    await task.finish({ keep: [] });
    return { status: "read_only", storeId: store.id, file: profileFile, selectMs, scanMs,
      elapsedMs: Math.round(performance.now() - started) };
  }
  const summary = {
    storeId: store.id, platform: store.platform, status: "running", steps: [],
    startedAt, selectMs, scanMs, saveMs: 0, readbackMs: 0,
    beforeFile: path.join(dir, "before.json"),
    readbackFiles: {},
  };
  const nextFile = () => path.join(dir, String(summary.steps.length + 1).padStart(3, "0") + ".json");
  let attemptedFile;
  let writing = false;
  const addStep = async action => {
    const recordFile = nextFile();
    attemptedFile = recordFile;
    const record = await action(recordFile);
    attemptedFile = undefined;
    const entry = { field: record.field, status: record.status, recordFile };
    if (record.saveUiClosedAt) {
      summary.saveMs += Date.parse(record.saveUiClosedAt) - Date.parse(record.finalSaveRequestedAt ?? record.saveRequestedAt);
    }
    summary.readbackMs += record.readbackMs ?? 0;
    summary.steps.push(entry);
    await writeRecord(path.join(dir, "summary.json"), summary);
    return { record, entry };
  };
  try {
    await writeRecord(summary.beforeFile, before);
    const plan = compileJob(job, before.minimum, before.fee);
    for (const item of plan) {
      if (item.enabled === undefined) continue;
      const control = manualPeriod(before.controls, item.title);
      if (item.enabled && !control.enabled && ![30, 60].includes(item.activeMinutes)) {
        throw new Error("开启手动时段前请选择 30 或 60 分钟自动关闭");
      }
      item.manualName = control.name;
    }
    writing = true;
    await applyPrices({ page, store, plan, before, dir, summary, addStep });
    for (const item of plan) {
      if (item.enabled === undefined) continue;
      await addStep(recordFile => setPeriodEnabled({
        page, store, periodTitle: item.manualName, enabled: item.enabled, activeMinutes: item.activeMinutes, recordFile,
      }));
    }
    summary.status = "verified";
  } catch (error) {
    summary.status = writing ? "needs_check" : "failed";
    summary.error = error.message;
    if (attemptedFile && await fs.access(attemptedFile).then(() => true, () => false)) {
      summary.lastAttemptFile = attemptedFile;
    }
    summary.spaceId = task.spaceId;
    summary.popup = await readBlockingPopup(page).catch(() => undefined);
    if (writing) summary.message = "先用 inspect 核对现场，再决定是否继续。";
  }
  if (summary.status === "verified") {
    await task.finish({ keep: [] }).catch(error => { summary.cleanupError = error.message; });
  }
  summary.finishedAt = new Date().toISOString();
  summary.elapsedMs = Math.round(performance.now() - started);
  await writeRecord(path.join(dir, "summary.json"), summary);
  return { ...summary, dir };
}

export async function inspectPlatform(config, platformKey, spaceId, runId, inspect = runStore, register = findStore) {
  const platform = Object.hasOwn(config.platforms, platformKey) && config.platforms[platformKey];
  const registered = config.stores.filter(store => store.platform === platformKey);
  if (!platform || !registered.length) throw new Error("这个中台没有登记门店，请检查 .local/stores.json。");
  const stores = [];
  for (const [index, store] of registered.entries()) {
    try {
      const result = await inspect({
        ...await register(config, store.id, false), spaceId: index === 0 ? spaceId : undefined, runId, onboarding: true,
      });
      stores.push(result);
      if (result.status === "login_required") {
        return { status: "login_required", platform: platform.name || platformKey, spaceId: result.spaceId,
          stores, waiting: registered.slice(index).map(item => item.id) };
      }
    } catch (error) {
      stores.push({ status: error.code === "busy" ? "busy" : "failed", storeId: store.id, error: error.message });
      if (error.code === "busy") {
        return { status: "busy", platform: platform.name || platformKey, stores,
          waiting: registered.slice(index).map(item => item.id) };
      }
    }
  }
  return { status: stores.every(store => store.status === "read_only") ? "read_only" : "needs_check",
    platform: platform.name || platformKey, stores };
}

async function run(request) {
  const report = async result => {
    if (request.resultFile) await writeRecord(request.resultFile, result);
    else console.log(JSON.stringify(result, null, 2));
  };
  if (request.command === "profiles") {
    await report(await profiles());
    return;
  }
  const config = await readJson(configFile, "门店清单 .local/stores.json");
  if (config?.version !== 1 || !Array.isArray(config.stores) || !config.platforms) {
    throw new Error("门店清单需包含 version: 1、platforms 和 stores。");
  }
  if (request.command === "onboard") {
    const result = await inspectPlatform(config, request.id, request.spaceId, request.runId);
    await report(result);
    if (["needs_check", "busy"].includes(result.status)) process.exitCode = 1;
    return;
  }
  const batch = request.command === "batch";
  const dir = path.join(local, "runs", request.runId);
  const job = request.jobFile && await readJson(request.jobFile, "任务文件");
  if (!batch) {
    const applying = request.command === "apply";
    if (applying && (!job || typeof job !== "object")) throw new Error("请提供包含 periods 的任务文件。");
    const result = await runStore({ ...await findStore(config, request.id, applying), job, dir, spaceId: request.spaceId, runId: request.runId });
    await report(result);
    if (["needs_check", "failed"].includes(result.status)) process.exitCode = 1;
    return;
  }
  if (job?.version !== 1 || !Array.isArray(job.stores) || !job.stores.length) throw new Error("批量任务需提供 version: 1 和非空 stores");
  const ids = new Set(), accountsByProfile = new Map(), groups = new Map();
  for (const item of job.stores) {
    if (typeof item?.id !== "string" || !/^\d+$/.test(item.id)) throw new Error("批量任务中的门店 ID 需为数字字符串。");
    if (ids.has(item.id)) throw new Error("批量任务内门店重复 " + item.id);
    ids.add(item.id);
    const entry = await findStore(config, item.id, true);
    const { store, platform } = entry;
    if (accountsByProfile.has(platform.profileId) && accountsByProfile.get(platform.profileId) !== store.account) {
      throw new Error("同一个 Ego 资料不能对应多个执行账号");
    }
    accountsByProfile.set(platform.profileId, store.account);
    if (!groups.has(store.account)) groups.set(store.account, []);
    groups.get(store.account).push({ ...entry, job: { version: 1, periods: item.periods }, spaceId: item.spaceId });
  }
  const started = performance.now(), startedAt = new Date().toISOString();
  const results = await Promise.all([...groups.values()].map(async entries => {
    const completed = [];
    for (const entry of entries) {
      try {
        completed.push(await runStore({ ...entry, dir: path.join(dir, entry.store.id), runId: request.runId }));
      } catch (error) {
        completed.push({ storeId: entry.store.id, status: error.code === "busy" ? "busy" : "failed", error: error.message });
      }
      if (completed.at(-1).status !== "verified") break;
    }
    for (const entry of entries.slice(completed.length)) completed.push({ storeId: entry.store.id, status: "skipped" });
    return completed;
  }));
  const stores = results.flat();
  const status = stores.every(store => store.status === "verified") ? "verified" : "needs_check";
  const result = { status, dir, startedAt, finishedAt: new Date().toISOString(), parallelAccounts: groups.size,
    elapsedMs: Math.round(performance.now() - started), stores };
  await writeRecord(path.join(dir, "batch-summary.json"), result);
  await report(result);
  if (status !== "verified") process.exitCode = 1;
}

if (requestUrl) {
  try {
    await run(await readJson(new URL(requestUrl), "执行请求"));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

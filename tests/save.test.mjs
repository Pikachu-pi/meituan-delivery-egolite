import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setMinimumPeriod } from "../src/adjust.mjs";
import { readPage } from "../src/ego-page.mjs";
import { applyPrices } from "../src/ego-runner.mjs";
import { compileJob } from "../src/job.mjs";
import { setPeriodEnabled } from "../src/special.mjs";

const store = { id: "90000001", name: "示例商店", account: "example" };
const title = "正常时段 (00:00-24:00)";

class SettingsPage {
  field = "minOrder";
  prices = { minOrder: ["19.90", "21.00"], baseFee: ["5.00", "7.00"] };
  changes = [];
  reloads = [];
  enabled = false;

  snapshot() {
    const values = this.draft ?? this.prices[this.field];
    const periods = this.field === "overview" ? [] : [{
      title, groupIndex: 0,
      rows: values.map((value, index) => ({
        label: ["近区 (1.25公里)", "快送 (6.5公里)"][index],
        rowIndex: index, sourceOrdinal: index + 1, value, surcharge: [],
      })),
    }];
    let modalDetails = [];
    if (this.dialog === "fee") {
      modalDetails = [{ index: 0, firstInput: this.feeInput, text: title + "\n近区\n基础配送费" }];
    } else if (this.dialog === "confirmFee") {
      modalDetails = [{ index: 1, text: "确认保存吗" }];
    } else if (this.dialog === "weather") {
      modalDetails = [{ index: 0, text: this.enabled ? "当前时段将暂停失效" : "自动关闭时间" }];
    }
    return {
      ready: true, storeId: store.id, storeName: store.name, account: store.account,
      kind: this.field, periods, modalDetails, globalSurcharge: null,
    };
  }

  async evaluate(callback, arg) {
    if (callback.name !== "inspectSite") {
      if (typeof arg === "string") return Boolean(this.draft);
      if (String(callback).includes("specialTimeSection_")) {
        return [{ name: "下雨", enabled: this.enabled, type: "manual", time: this.enabled ? "关闭时间 10:30" : "" }];
      }
      return [];
    }
    if (arg?.expectedId) assert.equal(arg.expectedId, store.id);
    if (arg?.action === "overview") { this.field = "overview"; return true; }
    if (arg?.action === "reload") {
      this.reloads.push(this.field);
      if (this.revertOnReload) this.prices.minOrder[0] = "19.90";
      return 1;
    }
    if (arg?.action === "fill") {
      if (this.dialog === "fee") this.feeInput = arg.fields[0].value;
      else for (const input of arg.fields) this.draft[Number(/data-md-row="(\d+)"/.exec(input.selector)[1])] = input.value;
      return true;
    }
    if (arg?.action === "activate") {
      const { selector } = arg;
      if (selector.includes("following-sibling")) this.field = selector.includes("顾客配送费") ? "baseFee" : "minOrder";
      else if (selector.includes('data-md-action="编辑"')) this.draft = [...this.prices.minOrder];
      else if (selector.includes('data-md-action="保存"')) {
        this.changes.push("minOrder");
        if (this.askToSave) {
          this.nativeDialog = { type: "confirm", message: "确认保存当前修改吗？" };
          throw new Error("a JavaScript confirm dialog opened while Runtime.evaluate was running");
        }
        this.prices.minOrder = this.draft;
        this.draft = null;
      } else if (selector.includes("actionBtn_")) {
        this.dialog = "fee";
        this.feeInput = this.prices.baseFee[0];
      } else if (selector.includes('data-md-modal-action="确定"') && this.dialog === "fee") {
        this.dialog = "confirmFee";
      } else if (this.dialog === "confirmFee" && selector.includes('data-md-modal-action="保存"')) {
        this.changes.push("baseFee");
        this.prices.baseFee[0] = this.feeInput;
        this.dialog = null;
      } else if (selector.includes("roo-switch")) this.dialog = "weather";
      else if (selector.includes("@value=")) this.weatherDuration = /@value='(\d+)'/.exec(selector)[1];
      else if (this.dialog === "weather" && selector.includes("data-md-modal-action")) {
        this.enabled = !this.enabled;
        this.dialog = null;
      } else assert.fail("Unexpected UI control: " + selector);
      return true;
    }
    return this.snapshot();
  }

  async waitForSelector() {}
  async info() { return { dialog: this.nativeDialog }; }
  async acceptDialog() {
    this.prices.minOrder = this.draft;
    this.draft = null;
    this.nativeDialog = null;
  }
  async waitForFunction(callback, arg) {
    if (this.missingSaveFeedback && Object.hasOwn(arg ?? {}, "groupIndex")) throw new Error("保存后未收到页面响应");
  }
}

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "delivery-save-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

async function runPrices(page, dir, task) {
  page.field = "minOrder";
  const minimum = await readPage(page, store);
  page.field = "baseFee";
  const fee = await readPage(page, store);
  const before = { minimum, fee };
  const plan = compileJob({ version: 1, periods: [{ title, ...task }] }, minimum, fee);
  const summary = { readbackMs: 0, readbackFiles: {} };
  const steps = [];
  await applyPrices({
    page, store, plan, before, dir, summary,
    async addStep(action) {
      const entry = { recordFile: path.join(dir, "step-" + steps.length + ".json") };
      const record = await action(entry.recordFile);
      steps.push(entry);
      return { record, entry };
    },
  });
  return { summary, steps };
}

test("两档起送价集中保存，配送费逐档保存，重开核对后可按记录恢复", async t => {
  const dir = await fixture(t);
  const page = new SettingsPage();
  const before = structuredClone(page.prices);
  const applied = await runPrices(page, dir, {
    minOrder: "16.00", baseFee: [{ range: { ordinaryTier: 1 }, value: "3.50" }],
  });
  assert.deepEqual(page.changes, ["minOrder", "baseFee"]);
  assert.deepEqual(page.reloads, ["minOrder", "baseFee"]);
  assert.deepEqual(applied.steps.map(step => step.status), ["verified", "verified"]);
  assert.deepEqual(page.prices.minOrder, ["16.00", "16.00"]);
  const original = JSON.parse(await fs.readFile(applied.steps[0].recordFile, "utf8"));
  assert.equal(original.before.periods[0].rows[0].value, "19.90");
  assert.equal(original.status, "verified");
  await runPrices(page, dir, {
    minOrder: [
      { range: { ordinaryTier: 1 }, from: "16.00", value: "19.90" },
      { range: { name: "快送" }, from: "16.00", value: "21.00" },
    ],
    baseFee: [{ range: { ordinaryTier: 1 }, from: "3.50", value: "5.00" }],
  });
  assert.deepEqual(page.prices.minOrder.map(Number), before.minOrder.map(Number));
  assert.deepEqual(page.prices.baseFee.map(Number), before.baseFee.map(Number));
});

test("重新打开后的读数不符时保留读数，保存步骤不标为核对通过", async t => {
  const dir = await fixture(t);
  const page = new SettingsPage();
  page.revertOnReload = true;
  await assert.rejects(runPrices(page, dir, { minOrder: "16.00" }), /完整回读/);
  const step = JSON.parse(await fs.readFile(path.join(dir, "step-0.json"), "utf8"));
  const actual = JSON.parse(await fs.readFile(path.join(dir, "minOrder-readback.json"), "utf8"));
  assert.equal(step.status, "observed");
  assert.equal(actual.periods[0].rows[0].value, "19.90");
  assert.deepEqual(page.changes, ["minOrder"]);
});

test("保存弹窗处理后读取实际值，只点击一次保存", async t => {
  const dir = await fixture(t);
  const page = new SettingsPage();
  page.askToSave = true;
  const recordFile = path.join(dir, "confirmed.json");
  const record = await setMinimumPeriod({ page, store, periodTitle: title, values: ["16.00", "16.00"], recordFile });
  assert.equal(record.status, "verified");
  assert.equal(record.nativeDialog.action, "accepted");
  assert.deepEqual(page.changes, ["minOrder"]);
  assert.deepEqual(page.reloads, ["minOrder"]);
});

test("保存发出后失去响应，记录待核实且没有再次保存", async t => {
  const dir = await fixture(t);
  const page = new SettingsPage();
  page.missingSaveFeedback = true;
  const recordFile = path.join(dir, "uncertain.json");
  await assert.rejects(setMinimumPeriod({ page, store, periodTitle: title, values: ["16.00", "16.00"], recordFile }), /未收到/);
  const record = JSON.parse(await fs.readFile(recordFile, "utf8"));
  assert.equal(record.status, "needs_check");
  assert.ok(record.saveRequestedAt);
  assert.deepEqual(page.changes, ["minOrder"]);
});

test("开启和关闭手动时段后，都重开总览核对", async t => {
  const dir = await fixture(t);
  const page = new SettingsPage();
  for (const enabled of [true, false]) {
    const result = await setPeriodEnabled({
      page, store, periodTitle: "下雨", enabled, activeMinutes: enabled ? 30 : undefined,
      recordFile: path.join(dir, "weather-" + enabled + ".json"),
    });
    assert.equal(result.status, "verified");
    assert.equal(result.after.periods[0].enabled, enabled);
  }
  assert.equal(page.weatherDuration, "30");
  assert.deepEqual(page.reloads, ["overview", "overview"]);
});

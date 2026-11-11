import test from "node:test";
import assert from "node:assert/strict";
import { compileJob } from "../src/job.mjs";
import { identifyRange } from "../src/definitions.mjs";

function sample(field) {
  return {
    periods: [
      { title: "正常时段 (00:00-24:00)", rows: ["快送 (6公里)", "住宅区 (0.8公里)", "园区 (4.2公里)"].map((label, rowIndex) => ({
        ...identifyRange(label, rowIndex + 1), rowIndex, cents: field === "minOrder" ? 1500 : 500,
      })) },
      { title: "恶劣天气时段 (临时范围和价格)", rows: [
        { ...identifyRange("住宅区 (0.8公里)", 1), rowIndex: 0, cents: field === "minOrder" ? 1700 : 600 },
      ] },
    ],
  };
}

test("全部范围覆盖快送，手动时段可以先配置价格再打开", () => {
  const plan = compileJob({
    version: 1, periods: [
      { title: "正常时段", minOrder: "15.10", baseFee: "5.10" },
      { title: "恶劣天气时段", minOrder: "17.10", enabled: true, activeMinutes: 30 },
    ],
  }, sample("minOrder"), sample("baseFee"));
  assert.deepEqual(plan[0].minimumValues, ["15.10", "15.10", "15.10"]);
  assert.deepEqual(plan[0].fees.map(item => item.range.name), ["快送", "住宅区", "园区"]);
  assert.equal(plan[1].title, "恶劣天气时段 (临时范围和价格)");
  assert.equal(plan[1].enabled, true);
});

test("价格页和配送费页档位不一致时拒绝生成任务", () => {
  const fee = sample("baseFee");
  fee.periods[0].rows[0].distanceKm = "6.1";
  assert.throws(() => compileJob({ version: 1, periods: [{ title: "正常时段", minOrder: "15.10" }] }, sample("minOrder"), fee), /对不上/);
});

test("恢复清单在现场值和上次提交值不一致时拒绝编译", () => {
  const job = { version: 1, periods: [{
    title: "正常时段",
    minOrder: [{ range: { ordinaryTier: 1 }, from: "15.10", value: "15.00" }],
  }] };
  assert.throws(() => compileJob(job, sample("minOrder"), sample("baseFee")), /原值与任务指定/);
});

test("时段原名和完整标题不能在同一任务重复指定", () => {
  const job = { version: 1, periods: [
    { title: "正常时段", minOrder: "15.10" },
    { title: "正常时段 (00:00-24:00)", minOrder: "15.20" },
  ] };
  assert.throws(() => compileJob(job, sample("minOrder"), sample("baseFee")), /同一个时段重复设置/);
});

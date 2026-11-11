import test from "node:test";
import assert from "node:assert/strict";
import { cents, amount, identifyRange, ordinaryTiers, selectRange } from "../src/definitions.mjs";

test("金额按分计算，保留零值并拒绝非法输入", () => {
  assert.equal(cents("0"), 0);
  assert.equal(cents("0.29"), 29);
  assert.equal(amount(cents("14.90") + 10), "15.00");
  for (const value of ["", "-1", "NaN", "1.001"]) assert.throws(() => cents(value));
});

test("普通档按实际距离排序，专送参与普通档，快送独立分类", () => {
  const rows = [
    identifyRange("快送 (1.02公里)", 4),
    identifyRange("1 (0.84公里)", 3),
    identifyRange("专送 (0.16公里)", 1),
    identifyRange("专送 (0.76公里)", 2),
  ];
  assert.deepEqual(ordinaryTiers(rows).map(row => [row.name, row.distanceKm, row.ordinaryTier]), [
    ["专送", "0.16", 1], ["专送", "0.76", 2], ["1", "0.84", 3],
  ]);
  assert.equal(selectRange(rows, { name: "快送", distanceKm: "1.02" }).sourceOrdinal, 4);
  assert.equal(identifyRange("配送圈 （ 2.0 公里 ）", 3, true).isQuickDelivery, true);
});

test("同距离范围通过原名或显示序号确定，不把行号当公里", () => {
  const rows = [identifyRange("东区（4.38公里）", 7), identifyRange("西区 (4.38公里)", 8)];
  assert.throws(() => selectRange(rows, { ordinaryTier: 1 }));
  assert.equal(selectRange(rows, { ordinaryTier: 1, name: "西区" }).sourceOrdinal, 8);
  assert.equal(selectRange(rows, { sourceOrdinal: 7 }).distanceKm, "4.38");
});

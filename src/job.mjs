import { amount, cents, rangeIdentity, selectRange } from "./definitions.mjs";

export function compareRangeLists(minimum, fee) {
  const shape = snapshot => snapshot.periods.map(period => ({
    title: period.title,
    ranges: period.rows.map(rangeIdentity),
  }));
  if (JSON.stringify(shape(minimum)) !== JSON.stringify(shape(fee))) {
    throw new Error("起送价与配送费设置页的时段或范围对不上");
  }
}

function pricingTargets(period, directive) {
  if (!Array.isArray(directive)) return period.rows.map(() => amount(cents(directive)));
  const values = period.rows.map(row => amount(row.cents));
  const used = new Set();
  for (const { range, value, from } of directive) {
    if (!range || !Object.keys(range).length) throw new Error("逐档设置必须指定范围");
    const row = selectRange(period.rows, range);
    if (from !== undefined && cents(from) !== row.cents) throw new Error("原值与任务指定的提交前读数不符 " + row.label);
    if (used.has(row.rowIndex)) throw new Error("同一范围重复设置");
    used.add(row.rowIndex);
    values[row.rowIndex] = amount(cents(value));
  }
  return values;
}

function pricePeriod(snapshot, title) {
  const matches = snapshot.periods.filter(period => period.title === title || period.title.startsWith(title + " ("));
  if (matches.length > 1) throw new Error("该时段有多个结果，请使用完整时段标题 " + title);
  return matches[0];
}

export function compileJob(job, minimum, fee) {
  compareRangeLists(minimum, fee);
  if (job.version !== 1 || !Array.isArray(job.periods) || !job.periods.length) {
    throw new Error("任务需包含 version: 1 和非空 periods");
  }
  const seen = new Set();
  return job.periods.map(item => {
    const { title, minOrder, baseFee, enabled, activeMinutes } = item;
    if (typeof title !== "string" || !title.trim()) throw new Error("时段标题缺失");
    if (minOrder === undefined && baseFee === undefined && enabled === undefined) throw new Error("时段缺少目标");
    if (enabled !== undefined && typeof enabled !== "boolean") throw new Error("enabled 必须是布尔值");
    if (activeMinutes !== undefined && (enabled !== true || !Number.isInteger(activeMinutes) || activeMinutes <= 0)) {
      throw new Error("activeMinutes 仅用于开启特殊时段，且必须为正整数分钟");
    }
    const minimumPeriod = pricePeriod(minimum, title);
    const feePeriod = pricePeriod(fee, title);
    const resolvedTitle = minimumPeriod?.title ?? title;
    if (seen.has(resolvedTitle)) throw new Error("同一个时段重复设置 " + resolvedTitle);
    seen.add(resolvedTitle);
    if ((minOrder !== undefined || baseFee !== undefined) && (!minimumPeriod || !feePeriod)) throw new Error("未找到该价格时段 " + title);
    const minimumValues = minOrder === undefined ? null : pricingTargets(minimumPeriod, minOrder);
    const fees = [];
    if (baseFee !== undefined) {
      const targets = pricingTargets(feePeriod, baseFee);
      for (const row of feePeriod.rows) {
        if (cents(targets[row.rowIndex]) === row.cents) continue;
        fees.push({
          range: { name: row.name, distanceKm: row.distanceKm, sourceOrdinal: row.sourceOrdinal },
          value: targets[row.rowIndex],
        });
      }
    }
    return { title: resolvedTitle, minimumValues, minimumRanges: minimumPeriod?.rows.map(rangeIdentity), fees, enabled, activeMinutes };
  });
}

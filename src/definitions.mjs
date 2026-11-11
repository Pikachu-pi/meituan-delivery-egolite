export function cents(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("金额必须为非负数，最多两位小数");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("金额超出支持范围");
  return result;
}

export function amount(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("金额分值无效");
  return (value / 100).toFixed(2);
}

export function identifyRange(label, ordinal, markedQuick = false) {
  const match = /^(.*?)\s*[（(]\s*(\d+(?:\.\d+)?)\s*公里\s*[）)]$/.exec(label.trim());
  if (!match || !match[1].trim() || !Number.isInteger(ordinal) || ordinal < 1) {
    throw new Error("无法识别范围原名、实际距离或显示序号 " + label);
  }
  return {
    name: match[1].trim(),
    distanceKm: match[2],
    sourceOrdinal: ordinal,
    isQuickDelivery: /快送/.test(match[1]) || markedQuick,
  };
}

export function ordinaryTiers(rows) {
  return rows
    .filter(row => !row.isQuickDelivery)
    .toSorted((a, b) => Number(a.distanceKm) - Number(b.distanceKm) || a.name.localeCompare(b.name))
    .map((row, index) => ({ ...row, ordinaryTier: index + 1 }));
}

export function rangeIdentity(row) {
  return [row.name, Number(row.distanceKm), row.sourceOrdinal, row.isQuickDelivery];
}

export function selectRange(rows, selector) {
  const keys = ["ordinaryTier", "name", "distanceKm", "sourceOrdinal"];
  if (!selector || Object.keys(selector).length === 0 || Object.keys(selector).some(key => !keys.includes(key))) {
    throw new Error("范围需按普通档位、原名、距离或显示序号指定");
  }
  let matches = rows;
  if (selector.ordinaryTier !== undefined) {
    matches = ordinaryTiers(rows).filter(row => row.ordinaryTier === selector.ordinaryTier);
    if (matches.length === 1) {
      const distance = matches[0].distanceKm;
      matches = rows.filter(row => !row.isQuickDelivery && Number(row.distanceKm) === Number(distance));
    }
  }
  if (selector.name !== undefined) matches = matches.filter(row => row.name === selector.name);
  if (selector.distanceKm !== undefined) matches = matches.filter(row => Number(row.distanceKm) === Number(selector.distanceKm));
  if (selector.sourceOrdinal !== undefined) matches = matches.filter(row => row.sourceOrdinal === selector.sourceOrdinal);
  if (matches.length !== 1) throw new Error("请用原名、实际距离或显示序号定位唯一范围");
  return matches[0];
}

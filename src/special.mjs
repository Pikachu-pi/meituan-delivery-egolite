import { readPage, openOverview, activate, xpathText, armFeedback, readFeedback, readSaveRequests, waitForModal } from "./ego-page.mjs";
import { writeRecord } from "./records.mjs";

export async function readPeriodControls(page, store) {
  const state = await readPage(page, store);
  if (state.kind !== "overview") throw new Error("请先打开配送信息总览");
  const periods = await page.evaluate(() => {
    function visit(doc) {
      if (new URL(doc.URL).pathname === "/unif/poimanage") return doc;
      for (const frame of doc.querySelectorAll("iframe")) {
        if (frame.contentDocument) { const found = visit(frame.contentDocument); if (found) return found; }
      }
    }
    const business = visit(document);
    return [...business.querySelectorAll('[class^="timeSectionItem_"], [class^="specialTimeSection_"]')].filter(item => item.getClientRects().length).map(item => {
      const name = item.querySelector('[class^="timeTitle_"] > span, [class^="periodTitle_"] > span')?.textContent.trim();
      const time = item.querySelector('[class^="DescShow_"]')?.innerText.trim();
      const effect = item.querySelector('[class^="effectTag_"]')?.textContent.trim() || null;
      const toggle = item.querySelector('[role="switch"], input[type="checkbox"]');
      const checked = toggle?.getAttribute("aria-checked");
      const enabled = checked === "true" || checked === "false" ? checked === "true" : toggle?.checked ?? null;
      return { name, time, effect, enabled, type: enabled === null ? "scheduled" : "manual" };
    });
  });
  return { readAt: state.readAt, periods };
}

export function manualPeriod(controls, title) {
  const candidates = controls.periods.filter(period => period.type === "manual"
    && (period.name === title || title === period.name + " (" + period.time + ")"));
  if (candidates.length !== 1) throw new Error("未找到唯一手动时段 " + title);
  return candidates[0];
}

function manualSelector(name) {
  return "xpath=//div[starts-with(@class,'specialTimeSection_')][.//div[starts-with(@class,'periodTitle_')]/span[normalize-space(.)="
    + xpathText(name) + "]]";
}

export async function confirmPeriodToggle({ page, store, periodTitle, enabled, activeMinutes, before, recordFile }) {
  const period = manualPeriod(before, periodTitle);
  const record = {
    version: 1, field: "periodEnabled", storeId: store.id, account: store.account,
    before, target: { name: period.name, enabled, activeMinutes }, status: "prepared",
  };
  const promptText = enabled ? "自动关闭时间" : "当前时段将暂停失效";
  await waitForModal(page, promptText);
  const state = await readPage(page, store);
  const modal = state.modalDetails.find(item => item.text.includes(promptText));
  if (!modal) throw new Error("未找到特殊时段确认窗口");
  const scope = '[data-md-modal="' + modal.index + '"]';
  if (enabled) {
    if (![30, 60].includes(activeMinutes)) {
      await activate(page, store, scope + ' button[data-md-modal-action="取消"]');
      throw new Error("美团要求设置自动关闭时间，请提供 30 或 60 分钟");
    }
    await activate(page, store, "xpath=//div[@data-md-modal='" + modal.index + "']//label[input[@type='radio' and @value='" + activeMinutes + "']]");
  }
  await armFeedback(page);
  record.status = "save_requested";
  record.saveRequestedAt = new Date().toISOString();
  await writeRecord(recordFile, record);
  try {
    const button = scope + ' button[data-md-modal-action="' + (enabled ? "确认" : "确定") + '"]';
    await activate(page, store, button);
    await waitForModal(page, promptText, false);
    record.saveUiClosedAt = new Date().toISOString();
    record.feedback = await readFeedback(page);
    record.requests = await readSaveRequests(page);
    const checking = performance.now();
    await openOverview(page, { fresh: true });
    record.after = await readPeriodControls(page, store);
    record.readbackMs = Math.round(performance.now() - checking);
    record.status = manualPeriod(record.after, period.name).enabled === enabled ? "verified" : "mismatch";
    record.finishedAt = new Date().toISOString();
    await writeRecord(recordFile, record);
    if (record.status !== "verified") throw new Error("重新打开后的手动时段开关状态不符");
    return record;
  } catch (error) {
    if (record.status === "save_requested") record.status = "needs_check";
    record.error = error.message;
    await writeRecord(recordFile, record);
    throw error;
  }
}

export async function setPeriodEnabled({ page, store, periodTitle, enabled, activeMinutes, recordFile }) {
  await openOverview(page);
  const before = await readPeriodControls(page, store);
  const period = manualPeriod(before, periodTitle);
  if (period.enabled === enabled) {
    const record = { field: "periodEnabled", storeId: store.id, before, after: before, target: { name: period.name, enabled }, status: "already_matched" };
    await writeRecord(recordFile, record);
    return record;
  }
  await activate(page, store, manualSelector(period.name) + "//div[contains(concat(' ',@class,' '),' roo-switch ')]");
  return confirmPeriodToggle({ page, store, periodTitle, enabled, activeMinutes, before, recordFile });
}

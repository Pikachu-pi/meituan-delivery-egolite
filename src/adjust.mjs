import { amount, cents, rangeIdentity, selectRange } from "./definitions.mjs";
import { readPage, openSettings, activate, fillFields, samePrices, armFeedback, readFeedback, readSaveRequests, xpathText, waitForModal, waitForPrice, waitPastNotice } from "./ego-page.mjs";
import { writeRecord } from "./records.mjs";

export async function setMinimumPeriod({ page, store, periodTitle, values, ranges, recordFile, expectedBefore, freshRead = true }) {
  await openSettings(page, "minOrder");
  const before = await readPage(page, store);
  if (expectedBefore && !samePrices(before, expectedBefore)) throw new Error("起送价已变化，请先核对实际设置");
  const period = before.periods.find(item => item.title === periodTitle);
  if (!period || values.length !== period.rows.length) throw new Error("时段或完整目标范围数量不符");
  if (ranges && JSON.stringify(period.rows.map(rangeIdentity)) !== JSON.stringify(ranges)) {
    throw new Error("起送价保存前的范围与目标清单不符");
  }
  const targetCents = values.map(cents);
  const expected = structuredClone(before);
  expected.periods.find(item => item.title === periodTitle).rows.forEach((row, index) => {
    row.cents = targetCents[index];
  });
  const record = {
    version: 1, field: "minOrder", storeId: store.id, account: store.account,
    startedAt: new Date().toISOString(), periodTitle, before, targets: values, status: "prepared",
  };
  await writeRecord(recordFile, record);
  if (samePrices(before, expected)) {
    record.status = "already_matched";
    record.after = before;
    await writeRecord(recordFile, record);
    return record;
  }
  const group = '[data-md-group="' + period.groupIndex + '"]';
  const editing = await page.evaluate(selector => {
    function visit(doc) {
      const inputs = doc.querySelectorAll(selector + " input[data-md-value]");
      if (inputs.length) return true;
      for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument && visit(frame.contentDocument)) return true;
      return false;
    }
    return visit(document);
  }, group);
  if (!editing) {
    await activate(page, store, group + ' button[data-md-action="编辑"]');
    await readPage(page, store);
  }
  const fields = period.rows.filter(row => row.cents !== targetCents[row.rowIndex]).map(row => ({
    selector: group + ' [data-md-row="' + row.rowIndex + '"] input[data-md-value]',
    value: amount(targetCents[row.rowIndex]),
  }));
  await fillFields(page, store, fields);
  const draft = await readPage(page, store);
  if (!samePrices(draft, expected)) throw new Error("填写后页面值与目标清单不符");
  await armFeedback(page);
  record.status = "save_requested";
  record.saveRequestedAt = new Date().toISOString();
  await writeRecord(recordFile, record);
  try {
    const dialog = await activate(page, store, group + ' button[data-md-action="保存"]', { save: true });
    if (dialog) record.nativeDialog = dialog;
    await waitPastNotice(page, () => page.waitForFunction(({ groupIndex }) => {
      function visit(doc) {
        const box = doc.querySelectorAll('[class^="settingBox_"]')[groupIndex];
        if (box && [...box.querySelectorAll("button")].some(button => button.textContent.trim() === "编辑")) return true;
        for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument && visit(frame.contentDocument)) return true;
        return false;
      }
      return visit(document);
    }, { groupIndex: period.groupIndex }, { timeout: 15000 }));
    record.saveUiClosedAt = new Date().toISOString();
    record.feedback = await readFeedback(page);
    record.requests = await readSaveRequests(page);
    if (freshRead) await openSettings(page, "minOrder", { fresh: true });
    record.after = await readPage(page, store);
    record.status = samePrices(record.after, expected) ? (freshRead ? "verified" : "observed") : "mismatch";
    record.finishedAt = new Date().toISOString();
    await writeRecord(recordFile, record);
    if (record.status === "mismatch") throw new Error("保存后起送价读数与目标不符");
    return record;
  } catch (error) {
    if (record.status === "save_requested") record.status = "needs_check";
    record.error = error.message;
    await writeRecord(recordFile, record);
    throw error;
  }
}

export async function setBaseFee({ page, store, periodTitle, range, value, recordFile, expectedBefore, freshRead = true }) {
  await openSettings(page, "baseFee");
  const before = await readPage(page, store);
  if (expectedBefore && !samePrices(before, expectedBefore)) throw new Error("配送费已变化，请先核对实际设置");
  const period = before.periods.find(item => item.title === periodTitle);
  if (!period) throw new Error("配送费时段不存在 " + periodTitle);
  const row = selectRange(period.rows, range);
  const target = cents(value);
  const expected = structuredClone(before);
  expected.periods.find(item => item.title === periodTitle).rows[row.rowIndex].cents = target;
  const record = {
    version: 1, field: "baseFee", storeId: store.id, account: store.account,
    startedAt: new Date().toISOString(), periodTitle, range, before, target: amount(target), status: "prepared",
  };
  await writeRecord(recordFile, record);
  if (target === row.cents) {
    record.status = "already_matched";
    record.after = before;
    await writeRecord(recordFile, record);
    return record;
  }
  const editor = "xpath=//div[starts-with(@class,'DeliverySettingItem_')][.//div[starts-with(@class,'title_') and normalize-space(.)="
    + xpathText(periodTitle) + "]]//div[starts-with(@class,'settingEditList_')][.//div[starts-with(@class,'name_') and normalize-space(.)="
    + xpathText(row.label) + "] and .//div[starts-with(@class,'iconText_') and normalize-space(.)="
    + xpathText(String(row.sourceOrdinal)) + "]]//div[starts-with(@class,'actionBtn_')]";
  await activate(page, store, editor);
  await waitForModal(page, "按配送范围分别设置配送费及加价");
  const draft = await readPage(page, store);
  const modal = draft.modalDetails.find(item => item.text.includes("基础配送费"));
  if (!modal || cents(modal.firstInput) !== row.cents) throw new Error("配送费编辑表单原值与范围读数不符");
  const compact = value => value.replace(/\s/g, "");
  if (!compact(modal.text).includes(compact(periodTitle)) || !modal.text.split("\n").map(x => x.trim()).includes(row.name)) {
    throw new Error("配送费编辑表单的时段或范围与目标不符");
  }
  const dialog = '[data-md-modal="' + modal.index + '"]';
  const input = dialog + ' input[data-md-input="0"]';
  await fillFields(page, store, [{ selector: input, value: String(target / 100) }]);
  const filled = await readPage(page, store);
  if (cents(filled.modalDetails.find(item => item.index === modal.index)?.firstInput) !== target) {
    throw new Error("基础配送费填写值与目标不符");
  }
  await armFeedback(page);
  record.status = "save_requested";
  record.saveRequestedAt = new Date().toISOString();
  await writeRecord(recordFile, record);
  try {
    const confirm = dialog + ' button[data-md-modal-action="确定"]';
    await activate(page, store, confirm);
    await waitForModal(page, "确认保存吗");
    const confirmationState = await readPage(page, store);
    const prompt = confirmationState.modalDetails.find(item => item.text.includes("确认保存吗"));
    if (!prompt) throw new Error("未找到配送费保存确认");
    const finalButton = '[data-md-modal="' + prompt.index + '"] button[data-md-modal-action="保存"]';
    record.finalSaveRequestedAt = new Date().toISOString();
    await writeRecord(recordFile, record);
    const nativeDialog = await activate(page, store, finalButton, { save: true });
    if (nativeDialog) record.nativeDialog = nativeDialog;
    await waitForModal(page, "按配送范围分别设置配送费及加价", false);
    await waitForModal(page, "确认保存吗", false);
    record.saveUiClosedAt = new Date().toISOString();
    record.feedback = await readFeedback(page);
    record.requests = await readSaveRequests(page);
    if (freshRead) await openSettings(page, "baseFee", { fresh: true });
    else await waitForPrice(page, { field: "baseFee", groupIndex: period.groupIndex, rowIndex: row.rowIndex, value: target });
    record.after = await readPage(page, store);
    record.status = samePrices(record.after, expected) ? (freshRead ? "verified" : "observed") : "mismatch";
    record.finishedAt = new Date().toISOString();
    await writeRecord(recordFile, record);
    if (record.status === "mismatch") throw new Error("保存后配送费或加价配置不符");
    return record;
  } catch (error) {
    if (record.status === "save_requested") record.status = "needs_check";
    record.error = error.message;
    await writeRecord(recordFile, record);
    throw error;
  }
}

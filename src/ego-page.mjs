import { identifyRange, cents } from "./definitions.mjs";

// Runs inside the page through Ego's documented evaluate method.
function inspectSite({ action = "read", selector, fields, expectedAccount, expectedId, expectedName } = {}) {
  let wrapper;
  let business;
  function visit(doc) {
    const url = new URL(doc.URL);
    if (url.pathname === "/page/sellercenter/commonWrapper") wrapper = doc;
    if (url.pathname === "/unif/poimanage") business = doc;
    for (const frame of doc.querySelectorAll("iframe")) {
      if (frame.contentDocument) visit(frame.contentDocument);
    }
  }
  visit(document);
  const account = document.querySelector(".acctinfo-container .txt")?.textContent.trim();
  const storeName = document.querySelector(".current-poi .txt")?.textContent.trim();
  const storeId = wrapper && new URL(wrapper.URL).searchParams.get("wmPoiId");
  if (expectedAccount && account !== expectedAccount) throw new Error("当前登录账号与登记账号不符");
  if (expectedId && storeId !== expectedId) throw new Error("当前门店 ID 与目标不符");
  if (expectedName && storeName !== expectedName) throw new Error("当前门店名称与登记不符");
  if (!business?.body) return { storeId, ready: false };
  if (action === "reload") {
    const previous = business.defaultView.performance.timeOrigin;
    business.location.reload();
    return previous;
  }
  if (action === "overview") {
    business.location.hash = "/poi-manage";
    return true;
  }
  if (action === "fill") {
    const win = business.defaultView;
    const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set;
    const edits = fields.map(({ selector: target, value }) => {
      const matches = [...business.querySelectorAll(target)].filter(element =>
        element.getClientRects().length && !element.disabled && !element.readOnly);
      if (matches.length !== 1) throw new Error("不能唯一识别可填写输入框 " + target);
      return { input: matches[0], value };
    });
    for (const { input, value } of edits) {
      if (!input.isConnected) throw new Error("填写过程中表单发生变化");
      setter.call(input, value);
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    return true;
  }
  if (action === "scroll" || action === "activate") {
    const matches = [];
    if (selector.startsWith("xpath=")) {
      const result = business.evaluate(selector.slice(6), business, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE);
      for (let i = 0; i < result.snapshotLength; i++) matches.push(result.snapshotItem(i));
    } else {
      matches.push(...business.querySelectorAll(selector));
    }
    const available = matches.filter(element => element.getClientRects().length && !element.disabled && element.getAttribute("aria-disabled") !== "true");
    const element = available.length === 1 ? available[0] : null;
    if (!element) throw new Error("页面元素不存在 " + selector);
    if (action === "activate") {
      element.click();
      return true;
    }
    element.scrollIntoView({ block: "center" });
    return true;
  }
  const periods = [];
  const groups = [...business.querySelectorAll('[class^="settingBox_"], [class^="DeliverySettingItem_"]')];
  for (const [index, box] of groups.entries()) {
    if (!box.getClientRects().length) continue;
    box.setAttribute("data-md-group", String(index));
    const title = box.querySelector('[class^="title_"]')?.textContent.trim();
    const rows = [...box.querySelectorAll('[class^="settingEditList_"]')].map((row, rowIndex) => {
      row.setAttribute("data-md-row", String(rowIndex));
      const input = row.querySelector('input:not([type="checkbox"])');
      if (input) input.setAttribute("data-md-value", "");
      const markedQuick = [row, ...row.querySelectorAll("*")].some(element => {
        if (!element.getClientRects().length) return false;
        const ownText = [...element.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(" ").trim();
        return /^(?:快送|快送范围|快送专属|极速快送)$/.test(ownText)
          || ["alt", "title", "aria-label"].some(attribute => /快送/.test(element.getAttribute(attribute) || ""));
      });
      return {
        label: row.querySelector('[class^="name_"]')?.textContent.trim(),
        value: input?.value ?? row.querySelector('[class^="price_"] span')?.textContent.trim(),
        surcharge: [...row.children].filter(e => e.tagName === "SPAN").map(e => e.textContent.trim()),
        sourceOrdinal: Number(row.querySelector('[class^="iconText_"]')?.textContent),
        rowIndex,
        markedQuick,
      };
    });
    for (const button of box.querySelectorAll("button")) {
      button.setAttribute("data-md-action", button.textContent.replace(/\s/g, ""));
    }
    periods.push({ title, groupIndex: index, rows });
  }
  const guide = business.querySelector('[class^="guideContent_"] [class^="closeIcon_"]');
  const dialogs = [...business.querySelectorAll(".roo-modal")].filter(e => e.getClientRects().length);
  const modalDetails = [];
  for (const [index, dialog] of dialogs.entries()) {
    dialog.setAttribute("data-md-modal", String(index));
    const inputs = [...dialog.querySelectorAll('input:not([type="checkbox"]):not([type="radio"])')].filter(input => input.getClientRects().length);
    inputs.forEach((input, inputIndex) => input.setAttribute("data-md-input", String(inputIndex)));
    for (const button of dialog.querySelectorAll("button")) {
      button.setAttribute("data-md-modal-action", button.textContent.replace(/\s/g, ""));
    }
    modalDetails.push({ index, firstInput: inputs[0]?.value, text: dialog.innerText.slice(0, 350) });
  }
  const feeHeading = business.body.innerText.includes("顾客配送费设置");
  const kind = periods.length ? (feeHeading ? "baseFee" : "minOrder") : "overview";
  const surchargeHeading = "对全部范围统一设置配送费加价";
  const surchargeCard = [...business.querySelectorAll('[class^="cardBox_"]')].find(card =>
    card.querySelector('[class^="title_"]')?.textContent.trim() === surchargeHeading);
  return {
    ready: true, storeId, account, storeName, route: business.URL, kind, periods,
    isClosed: [...document.querySelectorAll(".menu-container > span")].some(element => element.textContent.trim() === "停业中"),
    guideVisible: Boolean(guide?.getClientRects().length),
    modalDetails,
    globalSurcharge: surchargeCard ? surchargeCard.innerText.slice(surchargeHeading.length).trim() : null,
  };
}

export async function merchantIdentity(page) {
  return page.evaluate(() => ({
    account: document.querySelector(".acctinfo-container .txt")?.textContent.trim(),
    storeName: document.querySelector(".current-poi .txt")?.textContent.trim(),
  }));
}

export async function enterStore(page, store) {
  const identity = await merchantIdentity(page);
  if (!identity.account || (store.account && identity.account !== store.account)) {
    throw new Error("请在当前 Ego 资料登录对应美团账号");
  }
  if (identity.storeName !== store.name) {
    await page.click(".current-poi", { label: "打开门店选择器" });
    const input = 'input[placeholder="输入门店名称或门店ID即可快速查询"]';
    await page.waitForSelector(input, { state: "visible", timeout: 10000 });
    await page.fill(input, store.id);
    const result = "xpath=//li[.//*[normalize-space(text())=" + xpathText(store.name) + "]]";
    await page.waitForSelector(result, { state: "visible", timeout: 12000 });
    await page.click(result, { label: "切换登记门店" });
    await page.waitForFunction(name => document.querySelector(".current-poi .txt")?.textContent.trim() === name, store.name, { timeout: 15000 });
  }
  const menu = '[role="menuitem"][data-menu-id$="-Ori.Distribution"]';
  await page.waitForSelector(menu, { state: "attached", timeout: 12000 });
  await page.evaluate(selector => {
    const item = document.querySelector(selector);
    if (item.getAttribute("aria-expanded") !== "true") item.click();
  }, menu);
  const entry = '[role="menuitem"][data-key="Sub.DistributionInfo"]';
  await page.waitForSelector(entry, { state: "attached", timeout: 10000 });
  const link = await page.evaluate(selector => document.querySelector(selector).getAttribute("data-url"), entry);
  if (link?.startsWith("/page/sellercenter/commonWrapper?")) {
    const linkId = new URL(link, "https://shangoue.meituan.com").searchParams.get("wmPoiId");
    if (linkId && linkId !== store.id) {
      throw new Error("配送信息入口与登记门店不符，请重新核对门店");
    }
    await page.goto("https://shangoue.meituan.com/#" + link, { waitUntil: "commit", timeout: 12000 });
  } else {
    await page.evaluate(selector => document.querySelector(selector).click(), entry);
  }
  await openOverview(page);
  return readPage(page, { ...store, account: identity.account });
}

export function xpathText(value) {
  if (!value.includes("'")) return "'" + value + "'";
  if (!value.includes('"')) return '"' + value + '"';
  return "concat(" + value.split("'").map(part => "'" + part + "'").join(', "\'", ') + ")";
}

export async function readPage(page, store) {
  const raw = await page.evaluate(inspectSite, { expectedAccount: store.account, expectedId: store.id, expectedName: store.name });
  if (store.id && !raw.ready) throw new Error("门店配送设置还未加载");
  raw.readAt = new Date().toISOString();
  for (const period of raw.periods || []) {
    for (const row of period.rows) {
      Object.assign(row, identifyRange(row.label, row.sourceOrdinal, row.markedQuick));
      row.cents = cents(row.value);
    }
  }
  return raw;
}

export async function scrollTo(page, selector) {
  await page.evaluate(inspectSite, { action: "scroll", selector });
}

// The nested fee dialog can move between pointer hit testing and dispatch.
// Activate the identified visible UI control in its own document.
export async function activate(page, store, selector) {
  await page.evaluate(inspectSite, { action: "activate", selector, expectedAccount: store.account, expectedId: store.id, expectedName: store.name });
}

export async function fillFields(page, store, fields) {
  await page.evaluate(inspectSite, { action: "fill", fields, expectedAccount: store.account, expectedId: store.id, expectedName: store.name });
}

export async function waitForPrice(page, { field, groupIndex, rowIndex, value }) {
  await page.waitForFunction(({ field, groupIndex, rowIndex, value }) => {
    function visit(doc) {
      if (new URL(doc.URL).pathname === "/unif/poimanage") return doc;
      for (const frame of doc.querySelectorAll("iframe")) {
        if (frame.contentDocument) {
          const found = visit(frame.contentDocument);
          if (found) return found;
        }
      }
    }
    const documentWithPrices = visit(document);
    const groups = documentWithPrices?.querySelectorAll(field === "minOrder" ? '[class^="settingBox_"]' : '[class^="DeliverySettingItem_"]');
    const row = groups?.[groupIndex]?.querySelectorAll('[class^="settingEditList_"]')[rowIndex];
    const actual = row?.querySelector('[class^="price_"] span')?.textContent.trim();
    return actual !== undefined && actual !== "" && Math.round(Number(actual) * 100) === value;
  }, { field, groupIndex, rowIndex, value }, { timeout: 12000 });
}

export async function waitForModal(page, text, present = true) {
  await page.waitForFunction(({ text, present }) => {
    function visit(doc) {
      const visible = [...doc.querySelectorAll(".roo-modal")].some(modal =>
        modal.getClientRects().length > 0 && modal.innerText.includes(text));
      if (visible) return true;
      for (const frame of doc.querySelectorAll("iframe")) {
        if (frame.contentDocument && visit(frame.contentDocument)) return true;
      }
      return false;
    }
    return visit(document) === present;
  }, { text, present }, { timeout: 12000 });
}

export async function armFeedback(page) {
  await page.evaluate(() => {
    function visit(doc) {
      const win = doc.defaultView;
      win.__mdObserver?.disconnect();
      win.__mdFeedback = [];
      win.__mdFeedbackStart = win.performance.now();
      win.__mdObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) {
          const nodes = mutation.type === "characterData" ? [mutation.target] : mutation.addedNodes;
          for (const node of nodes) {
            const text = node.textContent?.trim();
            if (text && text.length < 180 && /成功|失败|错误|不合法|不能|请填写|不能为空/.test(text)) {
              win.__mdFeedback.push({ text, at: new Date().toISOString() });
            }
          }
        }
      });
      win.__mdObserver.observe(doc.body, { childList: true, characterData: true, subtree: true });
      for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument) visit(frame.contentDocument);
    }
    visit(document);
  });
}

export async function readFeedback(page) {
  return page.evaluate(() => {
    const feedback = [];
    function visit(doc) {
      feedback.push(...(doc.defaultView.__mdFeedback || []));
      for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument) visit(frame.contentDocument);
    }
    visit(document);
    return feedback;
  });
}

export async function readSaveRequests(page) {
  return page.evaluate(() => {
    const requests = [];
    function visit(doc) {
      const win = doc.defaultView;
      for (const item of win.performance.getEntriesByType("resource")) {
        const path = new URL(item.name).pathname;
        if (item.startTime >= win.__mdFeedbackStart && path.startsWith("/gw/distributioninfo/w/")) {
          requests.push({ path, httpStatus: item.responseStatus });
        }
      }
      for (const frame of doc.querySelectorAll("iframe")) if (frame.contentDocument) visit(frame.contentDocument);
    }
    visit(document);
    return requests;
  });
}

export async function dismissGuide(page) {
  const state = await page.evaluate(inspectSite);
  if (state.guideVisible) {
    await activate(page, {}, '[class^="guideContent_"] [class^="closeIcon_"]');
  }
}

async function waitForBusiness(page, selector, previousOrigin = null) {
  await page.waitForFunction(({ selector, previousOrigin }) => {
    function visit(doc) {
      if (new URL(doc.URL).pathname === "/unif/poimanage") return doc;
      for (const frame of doc.querySelectorAll("iframe")) {
        if (frame.contentDocument) {
          const found = visit(frame.contentDocument);
          if (found) return found;
        }
      }
    }
    const doc = visit(document);
    return Boolean(doc?.body && doc.defaultView.performance.timeOrigin !== previousOrigin && doc.querySelector(selector));
  }, { selector, previousOrigin }, { timeout: 15000 });
}

export async function openSettings(page, field, { fresh = false } = {}) {
  const state = await page.evaluate(inspectSite);
  if (state.kind === field && !fresh) return;
  const ready = (field === "minOrder" ? '[class^="settingBox_"]' : '[class^="DeliverySettingItem_"]') + ' [class^="price_"] span';
  if (state.kind === field && fresh) {
    const previousOrigin = await page.evaluate(inspectSite, { action: "reload" });
    await waitForBusiness(page, ready, previousOrigin);
    return;
  }
  await openOverview(page);
  const label = field === "minOrder" ? "起送价" : "顾客配送费";
  const selector = 'xpath=//span[normalize-space(.)="' + label + '"]/following-sibling::span[normalize-space(.)="设置"]';
  await page.waitForSelector(selector, { state: "attached", timeout: 12000 });
  await activate(page, {}, selector);
  await waitForBusiness(page, ready);
}

export async function openOverview(page, { fresh = false } = {}) {
  const state = await page.evaluate(inspectSite);
  if (state.ready && state.kind !== "overview") await page.evaluate(inspectSite, { action: "overview" });
  const previousOrigin = fresh && state.ready ? await page.evaluate(inspectSite, { action: "reload" }) : null;
  await waitForBusiness(page, '[class^="addTimeBtn_"]', previousOrigin);
  await dismissGuide(page);
}

export function samePrices(left, right) {
  const view = data => data.periods.map(period => ({
    title: period.title,
    rows: period.rows.map(row => ({ label: row.label, sourceOrdinal: row.sourceOrdinal, cents: row.cents, surcharge: row.surcharge })),
  }));
  return JSON.stringify(view(left)) === JSON.stringify(view(right))
    && left.globalSurcharge === right.globalSurcharge;
}

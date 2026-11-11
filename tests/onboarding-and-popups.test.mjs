import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveNativeDialog, waitPastNotice } from "../src/ego-page.mjs";
import { checkOnboardingProfile, inspectPlatform } from "../src/ego-runner.mjs";

const duringClick = new Error("a JavaScript confirm dialog opened while Runtime.evaluate was running; handle it before continuing");
function dialogPage(type, message) {
  return {
    accepted: 0,
    async info() { return { dialog: { type, message } }; },
    async acceptDialog() { this.accepted += 1; },
  };
}

test("已给定目标的保存和开关确认自动处理", async () => {
  for (const [message, intent] of [
    ["确认保存当前修改吗？", { save: true }],
    ["确定关闭下雨时段吗？", { period: "下雨", enabled: false }],
  ]) {
    const page = dialogPage("confirm", message);
    assert.equal((await resolveNativeDialog(page, duringClick, intent)).action, "accepted");
    assert.equal(page.accepted, 1);
  }
});

test("提示框自动关闭，含其他业务操作的确认框交回处理", async () => {
  const alert = dialogPage("alert", "保存成功");
  await resolveNativeDialog(alert, duringClick);
  assert.equal(alert.accepted, 1);

  for (const [type, message] of [
    ["confirm", "确定保存并开通自动续费吗？"],
    ["confirm", "确定开启下雨时段吗？"],
    ["prompt", "请输入短信验证码"],
  ]) {
    const page = dialogPage(type, message);
    await assert.rejects(resolveNativeDialog(page, duringClick, { period: "下雨", enabled: false }), /待判断的弹窗/);
    assert.equal(page.accepted, 0);
  }
});

test("原先就存在的确认框不作为本次保存的确认", async () => {
  const page = dialogPage("confirm", "确认保存吗？");
  await assert.rejects(resolveNativeDialog(page, new Error("JavaScript confirm dialog already open"), { save: true }), /待判断的弹窗/);
  assert.equal(page.accepted, 0);
});

test("等待期间出现提示时，只重新等待结果", async () => {
  const notices = [false, true];
  let waits = 0;
  const page = { async evaluate() { return notices.shift(); } };
  assert.equal(await waitPastNotice(page, async () => {
    if (++waits === 1) throw new Error("提示遮挡结果");
    return "已保存";
  }), "已保存");
  assert.equal(waits, 2);
});

test("首次引导按一个中台准备登录，登录后按该中台名单核对", async () => {
  const config = {
    platforms: { demo: { name: "示例中台" }, other: { name: "其他中台" } },
    stores: [
      { id: "90000001", platform: "demo" }, { id: "90000002", platform: "demo" },
      { id: "90000003", platform: "other" },
    ],
  };
  const register = async (_, id) => ({ id });
  const before = [];
  const login = await inspectPlatform(config, "demo", undefined, "run", async ({ id }) => {
    before.push(id);
    return { status: "login_required", storeId: id, spaceId: 42 };
  }, register);
  assert.deepEqual(before, ["90000001"]);
  assert.deepEqual(login.waiting, ["90000001", "90000002"]);
  assert.equal(login.spaceId, 42);

  const after = [];
  const result = await inspectPlatform(config, "demo", 42, "run", async ({ id, spaceId }) => {
    after.push([id, spaceId]);
    return { status: "read_only", storeId: id };
  }, register);
  assert.deepEqual(after, [["90000001", 42], ["90000002", undefined]]);
  assert.equal(result.status, "read_only");
});

test("首次引导按确认的格式输出", () => {
  const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
  const guide = (...args) => execFileSync(process.execPath, [cli, "guide", ...args], { encoding: "utf8" }).trimEnd();
  assert.equal(guide("install"), "**第一步　安装 Ego Lite**\n[下载 Ego Lite](https://lite.ego.app/download)，打开安装包，按窗口提示完成安装。装好后打开 Ego Lite，回复「已打开」。");
  assert.equal(guide("stores"), "**第二步　发门店名单**\n请发每家店的美团门店全名和门店 ID，再告诉我所属中台。如果都是同一个中台，中台名写一次就行。");
  assert.equal(guide("login", "小仓"), "**第三步　登录美团**\n「小仓」的美团登录页已打开。请在 Ego Lite 里登录，看到美团商家首页后，回复「登录完成」。");
  assert.equal(guide("login", "小仓", "乐心宜"), "**第三步　登录美团**\n「小仓」和「乐心宜」的美团登录页已打开。你可以先登录其中一个，完成后回复「小仓已登录」或「乐心宜已登录」。我会先核对已登录中台的门店。");
  assert.equal(guide("done", "3", "示例店（乙店）｜当前账号里找不到这个门店 ID"), "已核对并保存 3 家门店。下次直接告诉我要改哪家店、哪个时段、哪些档位和目标值。\n示例店（乙店）｜当前账号里找不到这个门店 ID");
});

test("新登记只使用与中台同名的 Ego 资料", () => {
  const available = [{ id: "1", name: "小仓" }, { id: "2", name: "默认资料" }];
  assert.equal(checkOnboardingProfile({ name: "小仓", profileId: "1" }, available), undefined);
  assert.deepEqual(checkOnboardingProfile({ name: "小仓", profileId: "2" }, available), {
    status: "profile_mismatch", platform: "小仓", profileName: "默认资料", matchingProfileIds: ["1"],
  });
  assert.deepEqual(checkOnboardingProfile({ name: "乐心宜", profileId: "2" }, available), {
    status: "profile_required", platform: "乐心宜", profileName: "默认资料", matchingProfileIds: [],
  });
});

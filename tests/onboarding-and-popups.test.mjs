import assert from "node:assert/strict";
import test from "node:test";
import { resolveNativeDialog, waitPastNotice } from "../src/ego-page.mjs";
import { inspectPlatform } from "../src/ego-runner.mjs";

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

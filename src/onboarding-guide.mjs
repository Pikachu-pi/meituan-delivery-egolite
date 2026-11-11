import { readFileSync } from "node:fs";

const fixed = JSON.parse(readFileSync(new URL("./onboarding-prompts.json", import.meta.url), "utf8"));

export function onboardingGuide(stage, values) {
  if (Object.hasOwn(fixed, stage) && !values.length) return fixed[stage];
  const names = values.map(value => value.trim());
  const validNames = names.length > 0 && names.every(name => name && !/[\r\n]/.test(name));
  if (stage === "profile" && validNames) {
    const quoted = names.map(name => "「" + name + "」").join("、");
    const count = names.length === 1 ? "" : "，每个名字各建一份";
    return "**准备 Ego Lite 资料**\n这一步请在 Ego Lite 的资料管理里操作。新建资料，名称填" + quoted + count
      + "。已有专用资料也可以改成同名。完成后回复「资料已准备好」，我来打开美团登录页。";
  }
  if (stage === "login" && validNames) {
    const heading = "**第三步　登录美团**\n";
    if (names.length === 1) {
      return heading + "「" + names[0]
        + "」的美团登录页已打开。请在 Ego Lite 里登录，看到美团商家首页后，回复「登录完成」。";
    }
    const quoted = names.map(name => "「" + name + "」");
    const platforms = quoted.slice(0, -1).join("、") + "和" + quoted.at(-1);
    const replies = names.map(name => "「" + name + "已登录」").join("或");
    return heading + platforms + "的美团登录页已打开。你可以先登录其中一个，完成后回复"
      + replies + "。我会先核对已登录中台的门店。";
  }
  if (stage === "done" && validNames && /^\d+$/.test(names[0])) {
    const [count, ...issues] = names;
    if (issues.every(issue => /^[^｜]+｜[^｜]+$/.test(issue))) {
      const result = "已核对并保存 " + count + " 家门店。"
        + (Number(count) > 0 ? "下次直接告诉我要改哪家店、哪个时段、哪些档位和目标值。" : "");
      return [result, ...issues].join("\n");
    }
  }
  throw new Error("用法：guide install|install-window|setup-window|open|node|node-window|stores|profile <中台名…>|login <中台名…>|inspect|done <成功数> [门店名｜原因…]");
}

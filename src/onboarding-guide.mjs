const fixed = {
  install: "**第一步　安装 Ego Lite**\n[下载 Ego Lite](https://lite.ego.app/download)，打开安装包，按窗口提示完成安装。装好后打开 Ego Lite，回复「已打开」。",
  open: "**第一步　打开 Ego Lite**\n打开 Ego Lite，按窗口提示完成首次设置。完成后重新打开当前对话工具，回复「已打开」。",
  node: "**安装 Node.js**\n[下载 Node.js](https://nodejs.org/)，打开安装包，按窗口提示完成安装。装好后回复「已装好」。",
  stores: "**第二步　发门店名单**\n请发每家店的美团门店全名和门店 ID，再告诉我所属中台。如果都是同一个中台，中台名写一次就行。",
  inspect: "**第四步　核对门店**\n我会按名单查看各店的时段、档位、起送价、配送费和特殊时段开关。这一步只查看。",
};

export function onboardingGuide(stage, values) {
  if (Object.hasOwn(fixed, stage) && !values.length) return fixed[stage];
  const names = values.map(value => value.trim());
  const validNames = names.length > 0 && names.every(name => name && !/[\r\n]/.test(name));
  if (stage === "profile" && validNames) {
    const quoted = names.map(name => "「" + name + "」").join("、");
    const count = names.length === 1 ? "" : "，每个中台各建一份";
    return "**准备 Ego Lite 资料**\n请在 Ego Lite 里新建资料，名称填" + quoted + count
      + "。已有专用资料也可以直接改名。完成后回复「资料已准备好」。";
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
  throw new Error("用法：guide install|open|node|stores|profile <中台名…>|login <中台名…>|inspect|done <成功数> [门店名｜原因…]");
}

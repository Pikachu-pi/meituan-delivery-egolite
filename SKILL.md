---
name: meituan-delivery-egolite
description: 用 Ego Lite 查看美团闪购门店的配送设置，或调整指定时段和档位的起送价、基础配送费及手动时段开关。
---

# 美团配送设置

使用本目录的 `cli.mjs`。安装和参数见 [README](README.md)。

- **登记门店**按下方首次引导执行。单独查看一家店时用 `inspect <门店ID>`。
- **调整或恢复**时，按本次指令确定门店、时段、范围和目标。用户要改全部时段时，先用 `inspect` 确认现场有哪些时段。区分普通档位和页面序号，[档位定义](docs/档位与时段.md) 也说明了怎么指定快送。把任务写在 `.local/`，单店用 `apply`，多店用 `batch`。恢复价格时，按原记录填写上次调后的值和当时的原值。示例见 [单店任务](examples/job.example.json) 和 [恢复任务](examples/restore.example.json)。
- **报告结果**时，读取运行摘要和相关明细，说明原值、保存反馈及重新打开后的实际值。结果待核实时先用 `inspect` 查看现场，再根据实际值和用户指令处理。

## 首次引导

每次只发当前一步，已经完成的步骤直接跳过。逐字发送 `node cli.mjs guide` 输出的正文，保留标题和换行。命令、环境检查和内部字段只用于执行。Node.js 尚未安装时，从 [固定文案](src/onboarding-guide.mjs) 取相应正文。

1. Ego Lite 未安装用 `guide install`，已安装但尚未完成首次设置用 `guide open`。缺 Node.js 时用 `guide node`。用 `profiles` 确认可连接。
2. 缺名单用 `guide stores`。按 [门店示例](examples/stores.example.json) 把名单保存到 `.local/stores.json`，保留已登记的其他门店。按名单里的中台全名查找同名 Ego 资料，保存对应的 `profileId`。找不到同名资料用 `guide profile <中台名…>`，等用户准备好后重新查找。同名资料有多份时请用户选一份。
3. 为资料就绪的中台运行 `onboard <中台键>`。仅对实际返回 `login_required` 的中台用 `guide login <中台名…>`。收到登录完成的回复后，用对应的空间 ID 继续。收到 `profile_required` 时按第二步准备资料。收到 `profile_mismatch` 时，重新核对同名资料，修正登记的 ID 后再打开登录页。
4. 开始只读核对时用 `guide inspect`。完成后用 `guide done <成功数> ["门店名｜具体原因"…]`，每家待处理门店占一行。现场特殊情况写入对应店档案的 `notes`。

## 遇到弹窗

先看正文、按钮和它出现在哪一步。当前任务的保存确认直接处理，说明提示可以关闭。脚本返回弹窗信息和空间 ID 时，在原空间看清内容，再在用户已给定的范围内选择并继续。出现登录、验证码，或弹窗要求用户作出新的业务选择时，才请用户操作。保存可能已发出时，处理完弹窗后先读实际值，再决定下一步。

同一 Ego 资料或账号正在处理任务时，等它结束再运行下一项。

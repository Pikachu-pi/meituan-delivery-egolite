---
name: meituan-delivery-egolite
description: 用 Ego Lite 查看美团闪购门店的配送设置，或调整指定时段和档位的起送价、基础配送费及手动时段开关。
---

# 美团配送设置

使用本目录的 `cli.mjs`。安装和参数见 [README](README.md)。

- **登记门店**时，在对话中收集门店全名、美团门店 ID 和所属中台，按 [门店示例](examples/stores.example.json) 保存到 `.local/stores.json`。用 `profiles` 找到对应的 Ego 资料。缺少资料时，请用户在 Ego 里以中台名创建。运行 `inspect <门店ID>` 核对账号、时段、档位和开关，现场特殊情况写入该店档案的 `notes`。需要登录时，请用户在 Ego 里登录，再用返回的空间 ID 继续。
- **调整或恢复**时，按本次指令确定门店、时段、范围和目标。用户要改全部时段时，先用 `inspect` 确认现场有哪些时段。区分普通档位和页面序号，[档位定义](docs/档位与时段.md) 也说明了怎么指定快送。把任务写在 `.local/`，单店用 `apply`，多店用 `batch`。恢复价格时，按原记录填写上次调后的值和当时的原值。示例见 [单店任务](examples/job.example.json) 和 [恢复任务](examples/restore.example.json)。
- **报告结果**时，读取运行摘要和相关明细，说明原值、保存反馈及重新打开后的实际值。结果待核实时先用 `inspect` 查看现场，再根据实际值和用户指令处理。

查看配置只调用 `inspect`。同一 Ego 资料或账号正在处理任务时，等它结束再运行下一项。

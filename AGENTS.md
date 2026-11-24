# AGENTS.md

本文件记录 dsh-macos-notify 的协作约定，供 AI agent 与人类协作者共同遵守。

## Git 提交

- **只在用户显式要求时提交**：没有收到明确的「提交 / commit」指令，不要执行 `git commit`。
- 完成一个完整功能点后，可以询问用户是否提交；得到确认前，改动保持未提交状态。
- 提交前先说明将要提交的文件范围，不要夹带无关改动。

## 发版

- **只在用户显式要求时发版**。发版请求授权以下动作：
  1. 完成发版所需的 release commit（仅 `package.json` 的 `version`、`docs/产品文档.md` 的头部与第 11 节版本记录，或用户明确指定的范围）；
  2. 创建 annotated tag，并 push 到 GitHub；
  3. 在 GitHub 上创建 / 发布 Release（published 状态，不是 draft，并标记 Latest）。
- 发版请求**不**授权提交尚未提交的功能改动。工作区存在这类改动时，先询问用户：先提交功能改动、只发布已提交内容，或取消发版。`release:tag` 要求工作区干净，因此其他未提交的无关改动也要先与用户确认处理方式。
- 未得到明确要求前，不得升级版本号、打 tag、push 或创建 Release；push 只作为用户要求的发版流程的一部分（或用户单独要求 push 时）执行。
- 发版操作清单：
  1. 确认工作区状态；有未提交的功能改动时，按上一条先询问用户；
  2. 更新 `package.json` 的 `version`、`docs/产品文档.md` 头部与第 11 节版本记录；
  3. 运行 `node --check client.js && npm test && npm run release:check`；
  4. 提交 release commit（仅发版所需的文件）；
  5. `npm run release:tag` 创建 annotated tag；
  6. `git push origin main --follow-tags`；
  7. 在 GitHub 上创建 / 发布 Release，确认状态为 published、标记为 Latest。
- 发布后核对 GitHub Releases 页面：目标版本出现在列表中、状态为 published、带 Latest 标记；如果只是 draft，应发布该草稿而不是重新创建。

## 测试

- 测试命令、断言矩阵与真机验收用例见 `docs/产品文档.md` §8。
- 改完 `client.js` 后至少运行 `node --check client.js && npm test`；涉及清单或文档版本时再运行 `npm run release:check`。
- 未提交的改动也可以先自测，但不要把测试产生的临时文件留在仓库里。

## 范围

本约定作用于本仓库。`docs/产品文档.md` §6.5 保留版本策略与发版工具说明，并在「提交与发版的授权」一节指向本文件；发版操作清单以本文件为准。超出本仓库范围（例如 ToolsResearcher 下的其他插件仓库）时，以对应项目的约定为准。

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
- 第 6、7 步获取 GitHub 凭据、push 与创建 Release 按「凭据与审批纪律」合并进同一次完全访问调用。

## 凭据与审批纪律

本机 GitHub 凭据存放在 macOS 钥匙串（`git` 的 `osxkeychain` helper）。DSH 在 workspace-write 沙箱下**网络可用但读不到钥匙串密文**，因此 push 与 GitHub API 都需要一次 `danger-full-access` 审批，那次调用通常还会伴随一次钥匙串授权框。审批是逐次的、不会改变会话模式，所以要尽量减少调用次数。

- **不要探测密钥**：不要为了「试一下凭据」执行 `security find-internet-password -w` / `-g`，也不要把 `git credential fill` 的输出写进文件。每个新进程都会新弹一次钥匙串授权框，用户拒绝后换工具重试只会继续弹；这些读取对发版没有价值，是反复授权的主要来源。
- **一次读完、一条命令做完**：需要凭据时，在同一次完全访问调用里 `git credential fill` 一次拿到凭据，然后在同一进程内完成 push、创建 Release、核对 Latest。不要让每个步骤各起一个进程各弹一次。
- **把第一次真实操作当作预检**：不单独做凭据 dry-run；真实 push 失败就停下问用户，不要换路重试。
- **提前说明次数**：动手前告诉用户本次预计的授权次数（完全访问 × N + 钥匙串 × M）。
- **凭据失效时停下来**：`brew upgrade git` 等会改变 helper 二进制、使钥匙串 ACL 失效并重新弹框；遇到这种情况交给用户处理，不要改用 ssh、`.netrc` 等其他凭据来源。
- **避免 token 进命令行参数**：用环境变量传给脚本或 curl 配置，不要写成 `https://token@...` 或 `-u user:token` 这类会出现在进程列表里的形式。

一次调用的形状（示意，token 只在进程内流转）：

```bash
cred=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)
GH_U=$(sed -n 's/^username=//p' <<<"$cred")
GH_P=$(sed -n 's/^password=//p' <<<"$cred")
# 随后在同一进程内：git push（经 askpass/环境变量取用）→ 调 api.github.com 建 Release → 核对 latest
```

## 测试

- 测试命令、断言矩阵与真机验收用例见 `docs/产品文档.md` §8。
- 改完 `client.js` 后至少运行 `node --check client.js && npm test`；涉及清单或文档版本时再运行 `npm run release:check`。
- 未提交的改动也可以先自测，但不要把测试产生的临时文件留在仓库里。

## 范围

本约定作用于本仓库。`docs/产品文档.md` §6.5 保留版本策略与发版工具说明，并在「提交与发版的授权」一节指向本文件；发版操作清单以本文件为准。超出本仓库范围（例如 ToolsResearcher 下的其他插件仓库）时，以对应项目的约定为准。

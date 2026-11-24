# AGENTS.md

本文件记录 dsh-macos-notify 的协作约定，供 AI agent 与人类协作者共同遵守。

## 提交与推送

- 完成一个自洽的改动后直接提交并推送（`git commit` + `git push origin main`），不需要逐次请示。
- 不提交半成品；一次任务里的多个逻辑改动分开提交；不夹带无关改动。
- 用户说「先看 diff」「先别提交」时以用户为准。
- push 被拒、需要 force、或会改写已推送历史时停下来问用户。

## 发版

- **只在用户明确要求时发版**。发版请求授权：release commit（仅 `package.json` 的 `version`、`docs/产品文档.md` 的头部与第 11 节版本记录，或用户指定范围）、创建 annotated tag、push，以及在 GitHub 创建 / 发布 Release（published 状态并标记 Latest）。
- 发版请求不授权提交尚未提交的功能改动；工作区存在这类改动时先问用户：先提交、只发布已提交内容，还是取消。
- 顺序：`node --check client.js && npm test && npm run release:check` → release commit → `npm run release:tag` → `git push origin main --follow-tags` → 创建 / 发布 Release。
- 发布后核对 GitHub Releases 页面：目标版本在列表中、状态 published、带 Latest；若只是 draft，发布该草稿，不要重建。

## 沙箱与凭据

- `workspace-write` 只限制写工作区以外的文件；网络、读取与钥匙串访问都可用。`git push`、`git ls-remote`、GitHub API 直接在默认沙箱执行，不要预先请求 `sandbox_permissions`。
- 只有工具调用显式带 `sandbox_permissions`，或命令真被拒绝（输出 `[sandbox: file access denied under ...]`）后升级重试，才会出现审批；git 操作不会触发后者。
- `fatal: failed to get: 100001` 加 `could not read Username ... Device not configured` 是钥匙串交互问题（登录钥匙串被锁，或新 git helper 首次访问需要授权）：解锁登录钥匙串，或先在终端 push 一次并选「始终允许」。不要改用 ssh、`.netrc` 或 token 文件。
- 凭据不进 argv 或文件：需要调 API 时 `git credential fill` 取一次，经 0600 临时 curl 配置使用，用完删除。

## 测试

- 测试命令、断言矩阵与真机验收用例见 `docs/产品文档.md` §8。
- 改完 `client.js` 后至少运行 `node --check client.js && npm test`；涉及清单或文档版本时再运行 `npm run release:check`。
- 未提交的改动也可以先自测，但不要把测试产生的临时文件留在仓库里。

## 范围

本约定作用于本仓库。`docs/产品文档.md` §6.5 保留版本策略与发版工具说明；提交、推送、发版与凭据的执行规则以本文件为准。超出本仓库范围（例如 ToolsResearcher 下的其他插件仓库）时，以对应项目的约定为准。

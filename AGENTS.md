# AGENTS.md

本文件记录 dsh-macos-notify 的协作约定，供 AI agent 与人类协作者共同遵守。

## 提交与推送

- 完成一个自洽的改动后直接提交并推送（`git commit` + `git push origin main`），不需要逐次请示。
- 不夹带无关改动；一次任务里的多个逻辑改动分开提交。
- push 被拒、需要 force、或会改写已推送历史时停下来问用户。

## 发版

- **只在用户明确要求时发版**。发版授权：release commit（仅 `package.json` 的 `version`、`docs/产品文档.md` 第 11 节版本记录，或用户指定范围）、创建 annotated tag、push、GitHub Release（published 并标记 Latest）。
- 发版不含未提交的功能改动；有这类改动先问用户。
- 顺序：`node --check client.js && npm test` → 更新 `version` 与第 11 节 → release commit → `git tag -a v<version> -m v<version>` → `git push origin main --follow-tags` → 创建 / 发布 Release 并核对 Latest。
- 若 Release 只是 draft，发布该草稿，不要重建。

## 沙箱与凭据

- `workspace-write` 只限制写工作区以外的文件；`git push`、`git ls-remote`、GitHub API 直接在默认沙箱执行，不要预先请求 `sandbox_permissions`。审批只在显式请求升级、或命令被拒（`[sandbox: file access denied under ...]`）后重试时出现。
- 钥匙串报 `failed to get: 100001` / `could not read Username ... Device not configured` 时按交互问题处理：解锁登录钥匙串，或先在终端 push 一次并选「始终允许」；不要改用 ssh、`.netrc` 或 token 文件。
- 凭据不进 argv 或文件：调 API 时 `git credential fill` 取一次，经 0600 临时 curl 配置使用，用完删除。

## 测试

- 测试命令、断言矩阵与真机验收用例见 `docs/产品文档.md` §8。
- 改完 `client.js` 后至少运行 `node --check client.js && npm test`。

## 范围

`docs/产品文档.md` §6.5 保留版本策略与工具说明；提交、推送、发版与凭据规则以本文件为准。其他仓库以各自约定为准。

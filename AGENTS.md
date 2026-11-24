# AGENTS.md

本文件记录 dsh-macos-notify 的协作约定。

## 提交与推送

- 完成一个自洽的改动后直接提交并推送（`git commit` + `git push origin main`），不需要逐次请示。

## 发版

- 只在用户明确要求时发版；release commit 只含 `package.json` 的 `version` 与 `docs/产品文档.md` 第 11 节版本记录（或用户指定范围），有未提交的功能改动先问用户。
- 顺序：`node --check client.js && npm test` → 改版本与第 11 节 → release commit → `git tag -a v<version> -m v<version>` → `git push origin main --follow-tags` → 创建 / 发布 GitHub Release（published + Latest）。

## 沙箱与凭据

- `workspace-write` 只限制写工作区外的文件；`git push`、`git ls-remote`、GitHub API 直接在默认沙箱执行，不要预先请求 `sandbox_permissions`。
- 钥匙串报 `failed to get: 100001` / `could not read Username ... Device not configured` 时按交互问题处理：解锁登录钥匙串，或先在终端 push 一次并选「始终允许」；不要改用 ssh、`.netrc` 或 token 文件。
- 调 API 的凭据用 `git credential fill` 取一次，经 0600 临时 curl 配置传入，不进 argv 或文件。

## 测试

- 改完 `client.js` 后至少运行 `node --check client.js && npm test`；用例与断言见 `docs/产品文档.md` §8。

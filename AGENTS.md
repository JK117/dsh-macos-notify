# AGENTS.md

本文件记录 dsh-macos-notify 的协作约定。

## 提交与推送

- 完成一个自洽的改动后直接提交并推送（`git commit` + `git push origin main`），不需要逐次请示。

## 发版

- 只在用户明确要求时发版；release commit 只含 `package.json` 的 `version` 与 `docs/产品文档.md` 第 11 节版本记录（或用户指定范围），有未提交的功能改动先问用户。
- 顺序：`node --check client.js && npm test` → 改版本与第 11 节 → release commit → `git tag -a v<version> -m v<version>` → `git push origin main --follow-tags` → 创建 / 发布 GitHub Release（published + Latest）。

## 测试

- 改完 `client.js` 后至少运行 `node --check client.js && npm test`；用例与断言见 `docs/产品文档.md` §8。

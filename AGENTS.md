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
- 第 6、7 步的 push 与 Release 操作直接在默认沙箱内完成；需要凭据时按「沙箱、凭据与审批」一节处理。

## 沙箱、凭据与审批

DSH 的 `workspace-write` 沙箱（macOS 上是 seatbelt `(allow default) (deny file-write*)` 加工作区与临时目录的写白名单）**只限制写工作区以外的文件**；网络、读取、钥匙串访问都不在它的管辖范围。因此 `git push`、`git ls-remote`、调用 GitHub API 都能直接在默认沙箱里执行，**不需要预先请求 `sandbox_permissions`**。

- 只有两种情况会出现 `danger-full-access` 审批：工具调用显式带了 `sandbox_permissions`；或命令真的被沙箱拒绝（输出 `[sandbox: file access denied under ...]`）后模型选择升级重试。git 操作不写工作区外的文件，不会触发后者。
- 在默认模式下先验证，不要单独预检凭据：`git ls-remote origin` 覆盖「网络 + 钥匙串认证」，`git push --dry-run origin HEAD:refs/heads/<name>` 覆盖一次完整认证握手；两者都应在零授权下通过。
- 出现 `fatal: failed to get: 100001`，随后 `could not read Username for 'https://github.com': Device not configured`：这是钥匙串侧的交互问题（登录钥匙串被锁，或新 git helper 首次访问需要授权），不是沙箱、也不是网络问题。处理方式：在「钥匙串访问」里解锁登录钥匙串；或先在终端里手动 push 一次并选择「始终允许」。授权按 host 持久化，github.com 这一条目对所有仓库生效。
- `brew upgrade git` 会更换 `git-credential-osxkeychain`，钥匙串 ACL 视其为新程序，首次读取可能再要求一次授权——一次性行为，不要为此改用 ssh、`.netrc` 或 token 文件。
- **不要探测密钥**：不要为了「试一下凭据」反复执行 `security find-internet-password -w` / `-g`，也不要把凭据写进文件或 argv（`https://token@...`、`-u user:token` 会出现在进程列表里）。

需要凭据调 GitHub API 时，在同一进程内取一次，交给 curl 的临时配置文件（0600，用完删除），token 不进 argv：

```bash
cred=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill)
GH_U=$(printf '%s\n' "$cred" | sed -n 's/^username=//p')
GH_P=$(printf '%s\n' "$cred" | sed -n 's/^password=//p')
cfg=$(mktemp)
printf 'user = "%s:%s"\n' "$GH_U" "$GH_P" >"$cfg"
curl -sS --config "$cfg" https://api.github.com/repos/JK117/dsh-macos-notify/releases/latest
rm -f "$cfg"
```

## 测试

- 测试命令、断言矩阵与真机验收用例见 `docs/产品文档.md` §8。
- 改完 `client.js` 后至少运行 `node --check client.js && npm test`；涉及清单或文档版本时再运行 `npm run release:check`。
- 未提交的改动也可以先自测，但不要把测试产生的临时文件留在仓库里。

## 范围

本约定作用于本仓库。`docs/产品文档.md` §6.5 保留版本策略与发版工具说明，并在「提交与发版的授权」一节指向本文件；发版操作清单以本文件为准。超出本仓库范围（例如 ToolsResearcher 下的其他插件仓库）时，以对应项目的约定为准。

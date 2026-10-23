# dsh-macos-notify（macOS 授权通知）

DSH 需要你授权时，除了对话里的「等待审批」面板，再弹一条 **macOS 系统通知**。窗口在后台、最小化，或授权请求属于另一个 Session 时，你能立刻看到；点击通知回到对应会话。

![icon](icon.svg)

## 行为

- 监听 DSH 的待处理交互（`ctx.uiSession.sessionStatus`），只处理 `kind === 'approval'` 的授权请求。
- **只在「看不到面板」时打扰你**：
  - 窗口不在前台（切到别的 App、最小化）→ 通知；
  - 窗口在前台，但授权请求属于另一个 Session → 通知；
  - 窗口在前台且正看着发起授权的那个 Session → 不通知，面板已经在眼前。
- 通知内容：
  - 标题：`DSH 等待你的授权`
  - 正文：`工具：原因`，例如 `Bash：write outside workspace`；第二行是 `会话：<标题>`。
- 点击通知：把应用带到前台，并切换到发起授权的 Session。
- 授权被处理（允许 / 拒绝）或请求被撤回后，对应通知自动关闭，不在通知中心留垃圾。
- 文案跟随 DSH 的语言设置（简体中文 / English）。

通知由渲染进程的标准 Web Notification API 发出，桌面端会把它显示为归属「DeepSeek Harness」的系统通知（有应用图标），而不是「脚本编辑器」之类的辅助进程。

## 安装

这是一个 DSH bundle，Host 半为空实现，全部逻辑在 Client 半（`client.js`）。

1. 侧边栏「插件」页 → **Add plugin** → **Install a third-party plugin**，填入本目录的绝对路径。
2. 安装后刷新窗口。
3. 触发一次授权（例如让 DSH 在工作区外写文件），把窗口切到后台，应该能看到系统通知。

卸载使用插件页的 Remove；关闭插件开关也会立即停止通知。

## 权限

- **桌面端**：通知权限由 DSH 桌面应用本身持有，首次弹通知时 macOS 可能询问一次「DeepSeek Harness 想要发送通知」，允许即可。
- **纯浏览器访问**（`dsh web` 后自己打开地址）：由浏览器发通知，需要在浏览器里允许该站点通知；若系统通知里找不到，检查「系统设置 → 通知 → 浏览器 / DeepSeek Harness」。
- 权限被拒绝时插件静默工作，不影响授权流程本身。

## 已知限制

- 依赖 DSH 客户端在线：通知由渲染进程发出，页面完全关闭时不会有通知（此时也没有可回答授权的 UI）。
- 只覆盖授权请求，不覆盖普通提问、计划审阅等其它待处理交互；需要时可扩展 `kind` 过滤。
- 使用的是 Web Notification，而不是直接调用 `NSUserNotification` / `UNUserNotificationCenter`，因此不提供自定义通知按钮或通知中心的持久操作。

## 开发与测试

无构建步骤，`client.js` 就是运行产物：

```bash
node --check client.js
node scripts/smoke-test.mjs
```

烟测在 VM 里加载 `client.js`，用假的 Cordis 上下文和 `Notification` 覆盖这些决策：何时通知、文案与 tag、点击后聚焦并切换会话、授权解决后关闭通知、权限被拒时静默、插件卸载时退订并清理。

## 目录结构

```text
dsh-macos-notify/
├── package.json        # bundle 清单：dsh.bundle.patch + dsh.client
├── cordis.patch.yml    # 插入 macos-notify 插件行
├── index.js            # Host 半：空实现
├── client.js           # 浏览器半：订阅待处理授权并弹系统通知
├── locale/             # 插件管理页的中英文标题与描述
├── icon.svg            # 插件图标
├── scripts/smoke-test.mjs
└── README.md
```

## 设计说明

- **为什么不拦 `approval/request` waterfall**：客户端 waterfall 由 `dsh-client-ui-approval` 先注册并一直持有到用户作答，后注册的监听器拿不到请求；即使拿到，也容易不小心「消费」掉授权。待处理交互快照是只读发布面，观察它不会改变任何决策。
- **为什么通知里带 Session 名**：后台 Session 的授权是最容易被忽略的情况，标题能让用户判断值不值得立刻切过去。
- **为什么前台当前会话不弹**：面板已经覆盖输入区，再弹系统通知只会造成重复打扰。
- **点击后才切换会话**：只看通知不改变当前视图；点击是显式意图，才调用 `uiWorkspace.openSession()`。

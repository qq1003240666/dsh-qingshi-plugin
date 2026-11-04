# 变更记录

版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

- **major**：破坏性变更（配置键改名/删除、工具有语义变化、需要用户重新登录或迁移数据）
- **minor**：新增工具、新增页面/窗口形态、新增配置项
- **patch**：修 bug、改提示词、调样式、改文档

## 0.20.0

- **新工具 `qingshi_about_me`**（31 个工具）：一句话回答「我是谁 / 我去过哪里 / 你了解我吗」这类模糊提问——
  一次返回本人资料、记录总数与年份跨度、主要类型、最近三条、族谱里可见的家人数，不用模型自己拼三个工具。
- **加深触发面**：`qingshi_profile` / `qingshi_find_experience` / `qingshi_family` / `qingshi_kinship` / `qingshi_me`
  的描述前面都加了一句「用户这样说时调我」，把「我是谁」「我去过哪里」「你知道我的故事吗」「我以前做过什么」这些
  原话直接写进描述里——很多客户端不读 `initialize.instructions`，但**工具描述一定会发给模型**。
- 系统提示词新增「模糊的『关于我』也要查」一节，明确禁止回「我不知道你的信息」。
- 文档补「它答不上来时怎么办」：贴 `AGENTS.md` 片段，或在对话里说一句「先查一下我的青史，再回答」。

## 0.19.0

- **数据目录改成「能写优先」**：以前固定用 `%APPDATA%\qingshi`，但有些 AI 客户端会锁住用户目录，
  登录时直接报 `EPERM: operation not permitted, open ...auth.json`。现在的顺序是
  显式配置 > `QINGSHI_HOME` > 平台默认 > 当前目录 `.qingshi/` > 系统临时目录，
  逐个真写一遍探测，选第一个能写的。
- 写不进去时不再抛裸 `EPERM`，而是说清楚「哪个目录不让写、怎么换地方」。
- 新工具 `qingshi_where`（30 个工具）：报告实际数据目录、为什么落在那儿、能不能写、里面有哪些文件。
- `test/paths.mjs` 补 4 条（平台目录被锁时退到当前目录、退到的目录确实可写、显式配置优先）。

## 0.18.1

- **修 MCP 工具的 inputSchema 不合法**：插件里写的是 DSH 的参数表（`{phone:{type:'string'}}`），
  DSH 会帮你转成 JSON Schema，但走 MCP 时没人转，客户端拿到的是没有 `type` 的对象。
  严格的客户端（workbuddy 等）会直接报 `tools[i].inputSchema.type 期望 object` 并拒绝连接。
  现在 `mcp/server.mjs` 自己把参数表转成标准 JSON Schema（含 `properties` / `required` / `items`）。
- `test/mcp.mjs` 补 7 条断言守住这条（每个工具 `type === 'object'`、`required` 都在 `properties` 里、数组参数带 `items`）

## 0.18.0

- 统一数据目录：所有宿主（DSH 插件、MCP、Claude Code、Codex、命令行）共用一份
  - Windows `%APPDATA%\qingshi`、macOS `~/Library/Application Support/qingshi`、Linux `~/.config/qingshi`
  - 覆盖方式：插件配置 `workspaceDir`、或环境变量 `QINGSHI_HOME` / `QINGSHI_WORKSPACE`
  - 老版本放在 `~/.dsh/qingshi-workspace`、`<cwd>/.qingshi-workspace` 的数据会一次性搬过来（只补缺、不覆盖、不搬 `shots/`）
- Electron / Chrome 的浏览器 profile 也固定到数据目录下的 `electron-profile/`、`browser-profile/`，不再随当前目录漂
- MCP `serverInfo.version` 改为直接读 `package.json`，避免版本号写死后走样
- 新增 `test/paths.mjs`（12 条断言），`npm test` 现在是 12 + 125 + 23 = 160 条

## 0.17.0

- 新增：`qingshi_login` 支持**无窗口环境**（MCP、远程、没有浏览器的机器）——传 `phone` 发短信、传 `code` 完成登录，凭证一样落本机
- 新增：能弹窗的环境仍然弹窗；探测不到 Electron / Chrome / Edge 时自动降级成短信验证码流程，并让模型去要手机号
- 新增：自绘标题栏加「‹ 返回」按钮（有历史就 `history.back()`，没有就回生涯页）
- 提示词：补「没有窗口时走短信验证码」的两步说明，并禁止把手机号、验证码写进回复

## 0.16.0

- 新增：`mcp/server.mjs` + `bin/qingshi-mcp.mjs`——同一个包同时是 **MCP server**，Codex / Claude Code / Cursor / Cline 等任何 MCP 客户端都能接，29 个工具原样暴露
- 新增：`docs/MCP.md`（各客户端配置、环境变量、工具分组、自检）
- 改动：`index.js` 的 `defineTool` 改成动态导入 + 恒等兜底，没有 `@deepseek-ai/dsh-tools` 的环境也能跑
- 测试：新增 `test/mcp.mjs`（20 条断言：协议、工具清单、未知工具/方法、未登录不抛异常），`npm test` 串跑两份

## 0.15.3

- 文档：README 重写为中文精简版，只留「是干什么的 / 会怎么用 / 怎么装 / 前置条件 / 注意事项 / 常见问题」
- 文档：原 README 的实现细节（三步结构、工作区、请求层、草稿与上传、工具清单、配置项）移到 `docs/MAINTAINER-NOTES.md`

## 0.15.2

- 文档：README 新增「这个插件解决什么问题」（中文 + 英文两版）、五组真实提问示例、三步工作原理
- 文档：新增三张配图（生涯时间轴、登录窗、族谱示意图，族谱用假名字）
- 文档：安装节改成 tarball 优先（本包暂未发布到 npm）

## 0.15.1

- 新增：登录页顶部「第一次用？」提示（先在小程序「青史永存」注册并绑定手机号）
- 修改：登录逻辑收敛为唯一入口（`openLoginWindowAndWait`），不再出现「去小程序登录 / 点我已登录」的旧提示
- 修复：`ensureLoggedIn` 不再只看本地 token 是否存在，改为真打一次后端探测；401/403 时才弹登录窗，且不清掉可能还有效的凭证
- 文档：新增 `PRODUCT-SOP.md`；README 工具数与安装方式对齐实际

## 0.15.0

- 新增：`qingshi_profile`（本人/家人资料、年龄、标签）
- 新增：`qingshi_set_privacy`、`qingshi_record` 的 `privacy` / `designatedUids` 参数（写入后补设可见性）
- 变更：登录窗改为 Electron 子窗口，登录成功 1 秒后自动关闭
- 变更：窗口改为全局共用（`browser-window.json` 注册表认领端口），跨会话复用同一个窗口
- 变更：页面状态快照（`browser-storage.json`），换窗口不丢族谱画布状态

## 0.14.3

- 新增：`qingshi_kinship`（按称谓倒推关系链，支持表侄/舅舅/堂哥等 40+ 称谓）
- 新增：`qingshi_family_expand`（自动展开族谱关系，不再改根节点）
- 新增：`qingshi_family_layout`（按小家庭成块重排卡片坐标）

## 0.14.0

- 新增：插件自带登录页（手机号 + 验证码），token 不经对话
- 新增：窗口随父进程退出（父进程 watchdog，2 秒内自关）

## 0.13.x 及更早

- 草稿箱 + 可视化编辑器（地图选点、图片、时间轴）
- 生涯记录读写、按标签/年份/地点检索
- 云端事件时间轴页

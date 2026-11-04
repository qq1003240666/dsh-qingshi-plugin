# 在别的 AI 里用（MCP）

这个包同时是一个 **MCP server**。除了 DSH，Codex、Claude Code、Cursor、Cline、Windsurf、
以及任何支持 MCP 的客户端，都可以通过 stdio 接上它，拿到同样的 29 个工具。

同一个 `index.js`、同一个 `lib/`，没有第二套实现——MCP 这层只是个薄壳。

---

## 它是怎么接上的

MCP 客户端按下面这条命令拉起进程，然后用换行分隔的 JSON-RPC 对话：

```sh
node <包目录>/bin/qingshi-mcp.mjs
```

不需要安装任何依赖（包本身 `dependencies` 是空的），Node >= 22.4 即可。

**数据位置**：和 DSH 插件用同一个目录（Windows 是 `%APPDATA%\qingshi`，macOS 是
`~/Library/Application Support/qingshi`，Linux 是 `~/.config/qingshi`），所以在 DSH 里登过一次，
在这里就不用再登。要换位置设 `QINGSHI_WORKSPACE`（或 `QINGSHI_HOME`）。

**登录**：MCP 客户端里通常没有可弹的窗口，所以 `qingshi_login` 会自动走短信验证码：

1. 把手机号交给它：`qingshi_login({"phone":"13800000000"})` → 会收到一条短信
2. 把 6 位验证码交给它：`qingshi_login({"code":"123456"})` → 登录完成、凭证存到本机

如果那台机器装了 Electron 或 Chrome/Edge，直接 `qingshi_login()` 会弹登录窗，效果一样。

---

## Claude Code

```sh
claude mcp add --transport stdio qingshi -- node /绝对路径/dsh-qingshi-plugin/bin/qingshi-mcp.mjs
```

或者写进项目里的 `.mcp.json`：

```json
{
  "mcpServers": {
    "qingshi": {
      "command": "node",
      "args": ["/绝对路径/dsh-qingshi-plugin/bin/qingshi-mcp.mjs"]
    }
  }
}
```

## Codex CLI

```sh
codex mcp add qingshi --command node --args /绝对路径/dsh-qingshi-plugin/bin/qingshi-mcp.mjs
```

或写进 `~/.codex/config.toml`：

```toml
[mcp_servers.qingshi]
command = "node"
args = ["/绝对路径/dsh-qingshi-plugin/bin/qingshi-mcp.mjs"]
# 工具默认 60 秒超时，登录/开窗类操作可能不够
tool_timeout_sec = 180
```

## Cursor / Cline / Windsurf

写进各自的 `mcpServers` 配置（Cursor 是 `~/.cursor/mcp.json`，Cline 在设置里的 MCP Servers 面板）：

```json
{
  "mcpServers": {
    "qingshi": {
      "command": "node",
      "args": ["/绝对路径/dsh-qingshi-plugin/bin/qingshi-mcp.mjs"]
    }
  }
}
```

Windows 上如果 `node` 不在 PATH 里，把 `command` 换成完整的 `node.exe` 路径，比如
`"C:/Program Files/nodejs/node.exe"`。

---

## 环境变量

不用改代码，都用环境变量配：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `QINGSHI_WORKSPACE` | `~/.dsh/qingshi-workspace` | 凭证、草稿、截图、窗口注册表都在这 |
| `QINGSHI_API_BASE_URL` | `https://api.iyouwc.cn` | 后端地址 |
| `QINGSHI_WEB_BASE_URL` | `https://qingshi.iyouwc.cn` | H5 站点（打开页面、族谱自动化用） |
| `QINGSHI_ALLOW_FAMILY_WRITE` | `false` | 允许替家人写记录 |
| `QINGSHI_AUTO_RECORD` | `suggest` | 自动记录策略 `off` / `suggest` / `auto` |
| `QINGSHI_OPEN_LOGIN_WINDOW` | `true` | 凭证失效时是否自动弹登录窗 |
| `QINGSHI_WINDOW_MODE` | `electron` | 窗口形态 `electron` / `app` / `kiosk` |
| `QINGSHI_LOGIN_TIMEOUT_MS` | 插件默认 | 登录等待时长 |

例：

```json
{
  "mcpServers": {
    "qingshi": {
      "command": "node",
      "args": ["/绝对路径/dsh-qingshi-plugin/bin/qingshi-mcp.mjs"],
      "env": {
        "QINGSHI_WORKSPACE": "D:/qingshi-data",
        "QINGSHI_AUTO_RECORD": "off"
      }
    }
  }
}
```

---

## 哪些工具在 MCP 里能用

**纯接口（20 个，任何 MCP 客户端都能用）**：`qingshi_me`、`qingshi_profile`、`qingshi_search`、
`qingshi_find_experience`、`qingshi_event`、`qingshi_family`、`qingshi_kinship`、`qingshi_record`、
`qingshi_edit`、`qingshi_delete`、`qingshi_restore`、`qingshi_set_privacy`、`qingshi_draft`、
`qingshi_publish`、`qingshi_login`、`qingshi_save_login`、`qingshi_logout`、`qingshi_pages`、
`qingshi_open_event`、`qingshi_prepare_event`

**需要本机窗口（9 个，靠 Electron 或 Chrome/Edge + CDP）**：`qingshi_open_h5`、`qingshi_ui_read`、
`qingshi_ui_goto`、`qingshi_ui_click`、`qingshi_ui_type`、`qingshi_ui_tap`、`qingshi_ui_shot`、
`qingshi_family_expand`、`qingshi_family_layout`

后面这组只有在「能起本地进程 + 有图形界面」的机器上才有意义。跑在 Docker、CI、或纯远程
环境里的 agent 用不上它们，其余 20 个照常能用。

> 想让模型不去碰窗口类工具，在客户端侧禁用即可，比如 Codex 的
> `disabled_tools = ["qingshi_ui_read", "qingshi_ui_goto", ...]`。

---

## 和 DSH 版本的区别

| | DSH 插件 | MCP server |
| --- | --- | --- |
| 工具 | 29 个 | 同 29 个 |
| 系统提示词 | `ctx.systemPrompt.section()` 注入 | 放在 MCP `initialize` 的 `instructions` 里 |
| 客户端 UI | 可以用 dsh-ui（按钮、表格） | 只有纯文本 |
| 依赖 | 需要 DSH 提供 `tools` / `systemPrompt` | 无，纯 Node |

---

## 自检

```sh
# 列出工具（会打印 29 个名字）
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | node bin/qingshi-mcp.mjs
```

正常输出两行 JSON：第一行 `protocolVersion: "2024-11-05"`，第二行 `tools` 数组长度 29。

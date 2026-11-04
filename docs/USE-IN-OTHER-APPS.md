# 在其他 AI 客户端里用

这份文档回答两件事：**怎么装**，以及**怎么让它真的去查青史**。

## 先说一句实话：MCP 没有「唤醒词」

MCP 不是语音助手，不存在「输入某个关键词才激活」的机制。客户端把工具清单交给模型，
模型自己判断该不该调。所以"能不能查青史"取决于三件事，按可靠程度排：

| 手段 | 谁负责 | 可靠程度 |
| --- | --- | --- |
| 工具描述（每个工具写了"什么时候用"） | 插件自带 | 好，但模型可能忽略 |
| `initialize` 里返回的 `instructions`（5.5K 字规则） | 插件自带 | **看客户端**：Claude Code 会读，Codex / workbuddy 多数不注入 |
| 项目里的规则文件（`AGENTS.md` / `CLAUDE.md`） | **你自己放** | 最稳，几乎所有客户端都读 |

结论：装完就能用，但如果发现它"答得像个没读过你日记的人"，把下面那段规则贴进项目里，
或者在对话里明说一句「用青史的工具查」，之后它就会一直用。

## 安装

包只有一个入口：`bin/qingshi-mcp.mjs`（stdio），需要 Node >= 22.4。

**Claude Code**

```bash
claude mcp add --transport stdio qingshi -- node /absolute/path/to/dsh-qingshi/bin/qingshi-mcp.mjs
```

**Codex**

```toml
# ~/.codex/config.toml
[mcp_servers.qingshi]
command = "node"
args = ["/absolute/path/to/dsh-qingshi/bin/qingshi-mcp.mjs"]
tool_timeout_sec = 180        # 登录要等短信，别用默认 60
```

**Cursor / Cline / 其他支持 `mcpServers` 的**

```json
{
  "mcpServers": {
    "qingshi": {
      "command": "node",
      "args": ["/absolute/path/to/dsh-qingshi/bin/qingshi-mcp.mjs"]
    }
  }
}
```

**workbuddy**：连接器里选「添加 MCP / stdio」，命令 `node`，参数同上。
请确认装的是 **0.18.1 或更新**——0.18.0 及更早的 `inputSchema` 不合法，会被严格客户端拒绝连接。

## 可粘贴的规则片段

放进项目的 `AGENTS.md`（Codex 系）或 `CLAUDE.md`（Claude Code），或客户端里的「自定义指令」：

```markdown
## 青史（qingshi）

用户用「青史」记录自己和家人的人生经历。MCP 里有 `qingshi_*` 工具，能读真实数据，不要凭空回忆。

- 「我是谁 / 我多大 / 我的生日」→ `qingshi_profile`
- 「我去过哪 / 2024 年干了什么 / 有没有去过沈阳 / 总结一下我的 2024」→ `qingshi_find_experience`
- 「我奶奶是谁 / 我妈有几个孩子 / 看看族谱」→ `qingshi_family`
- 「我表侄子是谁 / 我舅舅叫啥」这类**用称呼问亲戚**的 → `qingshi_kinship`，它会把称呼拆成关系链再沿族谱走
- 「打开那条记录看看」→ `qingshi_open_event`（需要本机桌面）
- 用户讲完一段故事要记 → 先核对标题要点，再 `qingshi_prepare_event` 把内容填进页面，让用户自己点「发布」

规则：
1. 查数据必须真的调工具，不许编；查不到就说没有。
2. 时间只认用户明说的，别把「最近」换算成具体日期。
3. 回复里不要贴 event_id、uid、文件路径、JSON 字段名；用他的说法指代（「去年九寨沟那次」）。
4. 新记录默认「所有人可见」，写完提一句，需要私密用 `qingshi_set_privacy`。
5. 发布权在用户手里，默认只准备、不替他点发布。
```

## 装完之后：先登录一次

第一次调工具它会说「还没登录青史」。MCP 环境通常弹不出窗口，所以走短信：

1. 你把手机号给它 → 它调 `qingshi_login` 发短信
2. 你把 6 位验证码给它 → 它调 `qingshi_login` 完成登录

号码必须先在微信小程序「青史永存」里注册并绑定过。凭证存在
`%APPDATA%\qingshi\auth.json`（macOS 是 `~/Library/Application Support/qingshi/auth.json`），
DSH 里登过一次，这里就不用再登——两边共用同一份。

## 会 / 不会被问住的场景

| 能直接用（纯接口） | 需要本机桌面窗口 |
| --- | --- |
| 查经历、总结生涯、查族谱、按称呼找亲戚、算年龄、看个人资料 | 打开 H5 页面、截图、点页面、打开某条记录详情、预填「添加生涯事件」 |
| 记一笔（直连云端 `qingshi_record`）、改标签/隐私、删除与恢复 | 需要 Electron 或 Chrome/Edge，且那台机器上有人在看 |

如果客户端跑在服务器上、没有图形界面，窗口类工具会明确报错，让它改用纯接口工具即可。

## 常见问题

- **「它说没有工具」**：确认客户端真的加载了这个 server（`tools/list` 应该有 29 个 `qingshi_*`）。
- **「连接器报 inputSchema 不合法」**：版本太旧，升到 0.18.1+。
- **「一直说没登录」**：凭证目录可能被 `QINGSHI_WORKSPACE` / `QINGSHI_HOME` 指到了别处，和 DSH 用的不是同一份。
- **「登录超时」**：把客户端的工具超时调到 180 秒——等短信会超过默认的 60 秒。

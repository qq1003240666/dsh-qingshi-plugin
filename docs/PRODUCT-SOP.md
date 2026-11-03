# 青史 × DSH 插件 · 产品 SOP

> 版本 0.15.0 ｜ 29 个工具 ｜ 一个常驻系统提示词段（`order: 900`）
> 一句话：让 AI 在对话里直接读写用户自己的「青史」——查生涯、看族谱、算年龄、把聊到的故事预填进记录页。

---

## 一、它是什么、不是什么

| 是 | 不是 |
| --- | --- |
| 给**模型**加的一组工具 + 一段系统提示词 | 一个独立 App / 有独立入口的软件 |
| 通过 DSH 插件的 `ctx.tools` + `ctx.systemPrompt.section()` 注入 | 一个聊天机器人 |
| 读写用户自己的青史后端（`api.iyouwc.cn`） | 另建一套数据 |
| 窗口只是「用户的界面」，数据永远走 API | 靠点页面抓数据（页面操作只做兜底） |

**没有"启动"这个动作**：插件在 Harness 启动时装载，提示词段和工具表随之常驻；
真正的触发点是**用户说的一句话**，由模型自己按提示词的场景表判断该调哪个工具。

---

## 二、什么时候会被触发（场景 → 动作）

提示词里有一张「场景 → 怎么做」的判断表，模型先查表再动手。

| 用户这么说 | 动作 |
| --- | --- |
| 打开青史 / 打开族谱 / 去个人中心 | `qingshi_open_h5`（带 route；不知道路由先 `qingshi_pages`） |
| 我有哪些旅行经历 / 2023 年都干了什么 / 有没有去过沈阳 | `qingshi_find_experience` |
| 总结一下我的 2024 / 分析我的工作经历 | `qingshi_find_experience`（mode=summary）→ 再归纳 |
| 看看族谱 / 我奶奶是谁 / 我妈有几个孩子 | `qingshi_family` |
| 我表侄子是谁 / 我舅舅叫啥 / 我有几个堂哥 | `qingshi_kinship`（按称呼拆关系链） |
| 展开父亲这一支 / 把关系都展开 | `qingshi_family_expand` |
| 把卡片摆整齐 / 按小家庭分块 | `qingshi_family_layout` |
| 打开那条看看 / 给我看当时的照片 | `qingshi_open_event` |
| 我多大了 / 我爸今年多少岁 | `qingshi_family`（每行带岁数） |
| 帮我记下来 / 记录一下这段 | 先核对标题要点 → `qingshi_prepare_event` 预填页面，用户自己点发布 |
| 帮我记一笔今天…… | `qingshi_draft`（本地草稿） |
| 把那条改成…… / 时间写错了 | `qingshi_event` 核对 → `qingshi_edit`（可 dryRun） |
| 把那条删了 | `qingshi_delete`（先预览，再 confirm） |
| 想找回删掉的 | `qingshi_restore` |
| 帮我润色一下（在表单页） | `qingshi_ui_read` + `qingshi_ui_type` |

---

## 三、工具清单（29 个，按用途分组）

### 登录与状态（4）
| 工具 | 干什么 |
| --- | --- |
| `qingshi_login` | 弹插件自己的登录页（127.0.0.1），手机号+验证码；成功后自动落盘并注入窗口 |
| `qingshi_save_login` | 从已开的青史窗口里读回 token（兜底，配合「我已登录」按钮） |
| `qingshi_me` | 报登录状态 + 云端能读到多少条（不回 uid） |
| `qingshi_logout` | 清本地凭证 + 清窗口 localStorage，跳登录页 |
| `qingshi_open_h5` | 打开/复用青史 H5 窗口，可指定路由 |

### 查询（3）
| 工具 | 干什么 |
| --- | --- |
| `qingshi_find_experience` | 关键词 / 年份区间 / 单年单月 / 标签 / 地点 多维筛选，或 summary 统计 |
| `qingshi_search` | 轻量关键词检索（只回 300 字摘要，复杂需求引导到上面那个） |
| `qingshi_event` | 读单条记录全文 |

### 写入（3）
| 工具 | 边界 |
| --- | --- |
| `qingshi_draft` | **只写本机** `drafts.json`（含图片），不算保存 |
| `qingshi_publish` | 真写云端：图片走 OSS 三段上传 → `/add_event`，**永久保存** |
| `qingshi_record` | 绕过草稿直连云端（快捷方式，必须用户明说） |
| `qingshi_prepare_event` | 预填「添加生涯事件」页，用户自己补图/地点并点发布 ← **首选记录方式** |

### 改 / 删 / 恢复（3）
`qingshi_edit`（支持 dryRun 预览）、`qingshi_delete`（两步确认，自动存本地快照）、`qingshi_restore`（把快照写回云端）。

### 族谱（5）
`qingshi_family`（上下 N 代 + 兄弟姐妹 + 岁数）、`qingshi_kinship`（称谓→关系链）、`qingshi_family_expand`（点菜单展开，一次调用跑完）、`qingshi_family_layout`（小家庭分块排版 + 自动缩放）、`qingshi_open_event`（打开事件详情页）。

### 页面兜底（6）
`qingshi_pages`（38 页路由查询）、`qingshi_ui_read`、`qingshi_ui_click`、`qingshi_ui_type`、`qingshi_ui_tap`（坐标点）、`qingshi_ui_shot`（截图）。

---

## 四、提示词结构（`qingshi:auto-record`，order 900）

| 小节 | 作用 |
| --- | --- |
| 最优先一条 | 「打开青史」→ 立刻 `qingshi_open_h5`，不解释、不读代码、不反问 |
| 场景 → 怎么做 | 上表那张判断表，20 条 |
| 登录这件事（只该发生一次） | 未登录时必须给「我已登录，保存凭证」按钮，收到 action 调 `qingshi_save_login` |
| 别把钱烧在来回读页面上 | 展开/排版/截图各调一次；禁止 `readPage → 判断 → 再点` 循环 |
| 族谱页面怎么操作（别过度思考） | 只允许「点卡片 → 点菜单」；**禁止改根节点、改关系、关掉重开换视角** |
| 硬规则 7 条 | 必须调工具拿数据不编造；时间只认用户明说；id/uid/路由内部用不写进回复；空数据直说；口语化；改删先核对/两步；draft 只用于新建 |
| 怎么说人话 | 不贴 id/路径/JSON/字段名；不复述工具输出；不用列表表格；引用用他的说法；只有明确问才给 id |
| 草稿 vs 云端 | draft=本地不算保存；publish/record=永久保存；默认只记草稿，发布权在用户 |
| 记事的分寸 | 什么算值得记（真实、本人或家人、时间/地点/人物/过程≥2 项）；什么不算（技术讨论、代码、设想、他人隐私、推测） |
| 青史 H5 兜底 | 页面级操作只在没有领域工具时才用；领域操作一律走领域工具 |

---

## 五、典型 SOP（照着走就行）

### SOP-1 查一段经历
1. `qingshi_find_experience({query|year|startYear~endYear|eventTag|location|mode})`
2. 用他的说法讲故事（「2025 年 9 月那次九寨沟」），不复述条数与条件
3. 他想自己看时间轴 → `qingshi_open_h5('/pages/career/career')`

### SOP-2 查亲属 + 年龄
1. `qingshi_family`（要三代以内、含兄弟姐妹、每行带岁数）
2. 用称谓问特定的人 → `qingshi_kinship({term:'表侄子'})`
3. 断链时说明「走到第几步、卡在谁、那一层有谁」，**不要说"没找到"**

### SOP-3 看某条记录
`qingshi_open_event({eventId})` 直接开详情页给他看；只要摘要才用 `qingshi_event`。

### SOP-4 聊完一段故事就记（推荐路径）
1. 先核对一句：「记成《带女儿去青龙峡》，2026-06-19，旅行，对吗？」
2. `qingshi_prepare_event({title, content, startDate, endDate?, isStage?, eventTag, location?})`
3. 页面打开、内容已填好 → 让他补图片/地点，**自己点「发布」**
4. 插件不代点发布；`/add_event` 没有幂等键，不要重复提交同一条

### SOP-5 族谱展开 / 排版
1. 展开：`qingshi_family_expand({displaySiblings:true, rounds:3})` → 只回一行
2. 排版：`qingshi_family_layout({gapX,levelGap,blockGap,fit:true})` → 一次算完坐标并重载
3. 卡片点不中时才 `qingshi_ui_tap({x,y})` + `qingshi_ui_shot` 确认

---

## 五·补、隐私与“他是谁”（0.14.2 / 0.14.3 新增）

- 需要知道用户身份时用 `qingshi_profile`：昵称、性别、生日→岁数、个性标签、简介（真实数据：二立 · 男 · 31 岁 · 天才少年/全栈工程师/摸鱼达人/INFT/E人伪装者 · 项目作者）。24 小时缓存，传 `refresh:true` 强刷。

- 后端字段：`privacy_setting ∈ {all, private, selected}`，指定人名单在同一 link item 的 `designated_uid`（只在校验 selected 时生效）。
- `/add_event`、`/edit_event` **都不接受**这个字段；只能单独调 `POST /edit_career_event_privacy_setting`。
- 因此插件的做法是：`qingshi_record` 写完立刻补一次隐私设置（用户给了 `privacy` 才设，否则提示"现在是所有人可见"）；已有记录用 `qingshi_set_privacy` 改。
- 默认值：新记录一律「所有人可见」，所以回复里要主动提一句，别让用户以为默认是私密的。
- 前端表单（eventEdit.vue / EventForm.vue）没有隐私控件；用户自己改的话要去生涯页那条记录的菜单里改。

## 六、边界与红线

1. **不编造**：查询一定先拿真实数据；没有就说没有。
2. **不漏 id**：event_id / uid / 路由 / token / 文件路径都不进回复（用户明确问才给）。
3. **时间不换算**：「最近」「前几天」不变成具体日期。
4. **改删谨慎**：改之前先读原文；删除必须两步（预览 → confirm）。
5. **发布权在用户**：默认写本地草稿；`publish` / `record` 都要用户明确说。
6. **代家人写默认关闭**：`allowFamilyWrite=false`，开启需用户明确同意。
7. **族谱只读操作**：只允许点菜单展开，禁止改根节点/关系。
8. **不重复开窗**：始终复用同一个窗口（`browser-window.json` 注册表认领端口）。

---

## 七、凭证与窗口生命周期（0.15.0 起只有一个登录入口）

- 每次调数据类工具都会先 `ensureLoggedIn()`：用当前 token 打一次最便宜的后端接口（`/get_career_list` limit 1）。
- 返回 200 → 直接继续，不起窗口、不问用户。
- 返回 401/403 → 先让 `authed()` 用 refresh_token 续一次；还不行就**清掉旧凭证并自动弹「插件自己的登录小窗」**（127.0.0.1 随机端口 + Electron 子窗口 470×640），用户在窗里输手机号 + 验证码；
  登完凭证自动写入 `%DSH_HOME%/qingshi-workspace/auth.json`（0600），登录窗 1 秒后自己关，然后**同一次工具调用里继续原来的查询**。
- 兼容：`qingshi_login` 仍是同一个流程（可传 `force: true` 换账号）；`qingshi_save_login` 只作为兜底保留，提示词里不再指挥模型给按钮。
- 明确禁止：让用户去小程序/H5 登录页手动登录、输出「我已登录，保存凭证」按钮、说“请先登录”。

| 项 | 行为 |
| --- | --- |
| 登录 | 插件自带登录页（470×640），请求带 `X-Client-Platform: plugin`；成功后 1 秒关窗 |
| 存储 | `~/.dsh/qingshi-workspace/auth.json`（0600，`accessToken` + `refreshToken` + `refreshedAt`） |
| 续期 | AT 剩余 <10 分钟主动 `/get_token`；>5 天没续则静默保活一次（RT 7 天窗口） |
| 失效 | 401 → 先向窗口要 token 再重试；403 → 提示重新登录（给按钮） |
| 窗口 | Electron 外壳是 Harness 子进程，带 `QINGSHI_PARENT_PID`，父进程退出 2 秒内自关 |

---

## 八、已知限制

- `client_platform` 想落库成 `plugin`，后端必须部署支持 `X-Client-Platform` 的版本；否则旧后端仍写 `h5`。
- 后端 `refresh_tokens` 若仍按 `uid` 唯一，多端登录会互相顶号。
- 族谱里性别/称呼录错（例如姑姑被存成「男/弟弟」）会让按性别的称谓查不到，插件只能说清断在哪一层。
- `/add_event` 无幂等键：重复提交会产生两条，发布前必须核对。
- 本地草稿不随机器走（在 `workspace/drafts.json` 与 `media/`）。

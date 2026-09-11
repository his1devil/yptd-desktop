# 交互手感探索（2026-09-12）

可以上手玩的原型页：见会话里发的 artifact 链接（源文件 `yptd-interactions.html`）。这里只记结论。

## 诊断
现有动效停在「元素出现时淡入 / 上浮」：瀑布进场、新消息上浮、悬浮条、右栏宽度过渡、主题颜色过渡、几处脉冲。
缺的是**状态之间的连续**：切会话是硬切；发文字要等回显；侧栏重排是跳变；图片放大是弹层；看不到谁在线、谁在打字、agent 在忙什么；
打开有未读的会话落在最底。平台底子够：Electron 33 = Chromium 130，View Transitions、`linear()` 弹簧、`@starting-style`、
滚动驱动动画、`scrollend`、`field-sizing` 都能直接用。性能红线不变：只动 transform / opacity，虚拟列表外层定位不碰。

## 14 个点子（S 半天内 · M 一两天 · L 要服务端/SDK 配合）
| # | 点子 | 复杂度 | 关键实现 |
|---|---|---|---|
| 1 | 切会话：旧流淡出，头像与标题作为共享元素滑到新位置 | S | `startViewTransition` 包住 `ui.open`；`Head` 的头像/标题给 `view-transition-name` |
| 2 | 侧栏重排 FLIP：会话「滑」到顶上，未读徽标弹簧弹出 | S | 渲染前后量 rect，transform 补差；`animation: pop var(--spring)` |
| 3 | 不在底部时来新消息：底部药丸「↓ 3 条新消息 · 谁：开头」，点了平滑滚到底 | S | 已有 `atBottom`；`scrollTo smooth` + `scrollend` 清零 |
| 4 | 连续发言折叠：同人 90 秒内后续消息省掉头像/名字，悬停在左侧留白显时间 | S | `buildRows` 打 `continued`；估高减 26px |
| 5 | 「以下是新消息」分割线 + 滚动时浮起的日期药丸 | M | 用 `unreadCount` 定位第一条未读，`scrollToIndex` 到它；日期药丸监听 scroll |
| 6 | 发送即上屏：文字也走本地占位 → 回显替换；输入框高度过渡 | S | 复用 `localMessage()`；`field-sizing: content` + `transition: height` |
| 7 | 表情回应从悬浮条飞入芯片再弹开；再点缩回 | S | 克隆节点 WAAPI 飞行；本地先折进表 |
| 8 | 图片放大：共享元素从原位长大成灯箱，Esc 缩回；左右切同条消息的图 | S | 只给正在放大的那张 `view-transition-name: shot` |
| 9 | 在线点 / 正在输入 / agent 忙碌环 | M | SDK：`subscribeUsersStatus`、`OnUserStatusChanged`、`changeInputStates`、`OnConversationUserInputStatusChanged`；忙碌读 runs store |
| 10 | 群里派活后原消息下一行活的进度（思考 → 工具 → 写回答），答完收成「已回复 ↓」 | M | 收到 👌 即知目标消息；`runs.attach` 订阅 SSE 渲染成一行 |
| 11 | 选中即派活：划一段字浮出「问 X · 引用 · 复制」 | S | `selectionchange` + range rect；`setQuote + composerBus.insert('@X ')` |
| 12 | 切主题：从点击处圆形扩散 | S | `startViewTransition` + `::view-transition-new(root) { clip-path: circle() }` |
| 13 | 启动编排：图标栏、侧栏、主区、右栏 60ms 错开落位，只冷启动播一次 | S | 根节点 `booted` 类 + `animation-delay` |
| 14 | 键盘：⌥↑/↓ 切会话、⌥⇧↓ 下一个未读、⌘1–9 置顶、Esc 回输入框、`/` 命令、`:emoji:`、⌘. 右栏 | S | 全局 keydown 表 |

## 进度
- **第一批已做完（v0.3.4）**：#1 #2 #3 #4 #6 #7 #8 #12 #13 #14。实现都在 `src/renderer/src/motion/`（`transition.ts` View Transitions 包装、
  `fly.ts` 表情飞行、`useFlip.ts` 列表重排）和各视图里；全局的 View Transition 规则在 `styles/tokens.css`。
  切会话的首帧成本：渲染 15–45ms + 过渡快照约 20ms，旧内容在这期间一直在屏上，不会白一下。
- 第二批（存在感）和第三批（独有动作）未开始。

## 建议批次
1. **手感**（约 2 天，全客户端）：#6 #3 #4 #1 #2 #7 #8 #12 #13 #14——每天几百次的动作都变顺，「丝滑」的主体。
2. **存在感**（约 2 天，SDK 接口已有，服务端不动）：#9 #10 #5——频道从消息列表变成有人的房间，「耳目一新」的主体。
3. **独有动作**（各半天到一天）：#11、灯箱左右切图、引用悬停看上下文、收藏消息进收件箱。

不做：音效（内部工具，办公室里响会烦）；整页转场（切区段仍即时，只有会话内容过渡）。全部遵守系统「减弱动态效果」。

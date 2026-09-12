# 当前计划（2026-09-12 定，2026-09-13 四条全部做完）

> 进度：四条工作流都已实现并在开发版上实测。登录密码见服务端 `PUT /v1/me/password`；
> Logo 见 `components/Mark.tsx`；图片查看器见 `views/Lightbox.tsx`（react-photo-view 受控模式）；
> 输入框见 `views/editor/`（Lexical 纯文本模式 + token 模式的 @ 色块）。

四条工作流，按 登录 → Logo → 图片查看器 → 输入框 的顺序做。前三条互不相干，最后一条最大也最容易返工，所以放在最后。

选型结论已定：图片用 react-photo-view，输入框用 Lexical 走 Discord 模型。依据见本文末「选型依据」。

## 一、登录与密码

现状的问题：退出会清掉这台机器的设备凭据，而登录页只有邀请码一条路，于是「退出 = 要一个新邀请码」。
服务端其实已经有 `POST /v1/login/password`，用户表有密码哈希字段，`store.SetPasswordHash` 也写好了，
但没有任何地方调用它——今天根本没有办法给账号设密码。缺的就是这一个口子。

**服务端**

- `PATCH /v1/me` 接受 `password` 和可选的 `old_password`：用设备凭据鉴权；账号已有密码时必须给对旧密码；
  最短 8 位。落到已有的 `SetPasswordHash`。
- `GET /v1/me` 增加 `has_password`，客户端据此显示「设置密码」还是「修改密码」。
- 注册接口本来就收 `password`，不动。

**客户端**

- `im/auth.ts` 加 `loginWithPassword()` 和 `setPassword()`。
- 登录页分两条路：「登录已有账号」（账号 + 密码）和「用邀请码加入」。记住上次的账号名，
  退出后默认停在密码那条路上、账号已填好，只需要输密码。
- 设置 → 资料：设置密码 / 修改密码，显示当前有没有设过。
- 邀请码注册的第二步加一个可选的密码字段，新账号当场就能在别的机器上登录。
- 退出的行为不变（清掉这台机器的凭据），但落到的登录页现在有密码这条路。

**要验的**：同一账号在两台 Mac 上登录时 OpenIM 的多端策略会不会互踢。客户端已有被踢下线的处理，
但行为要确认。

## 二、Logo 与 agent 头像

素材：`yptd-app/Resources/icon-1024.png` 是干净的 1024 原图（给的两个 logo.png 是展示拼版图，不能直接用）。

- **应用图标**：用 `iconutil` 生成 `build/icon.icns` 和 `build/icon.png`，替掉现在的 Electron 默认图标。
- **矢量标记**：把这个标记重绘成单色 SVG 组件（`components/Mark.tsx`），用 `currentColor`，
  去掉原图的立体阴影——小尺寸下更清楚，也才能换色。几何是：粗描边的圆润脸、两只竖圆角眼睛、
  半圆帽子带两道斜线、一圈平帽檐。
- **agent 头像**：`Avatar` 在 `kind='agent'` 且没有真头像时画这个标记，颜色用名册里该 agent 的
  `color`（服务端按位次分配，四个 agent 四个色）。这些色是给深色模式调的，浅色模式要压暗一档，
  用 `color-mix()` 在 CSS 里派生，不再各写一套。
- **侧边栏的机器人图标**：`IconAgents` 换成同一个标记的单色版。

**要认的代价**：四个 agent 都用同一个标记、只靠颜色区分，会比现在的首字母更难一眼分辨。这是明确要求，
做完看效果再决定要不要加回一个角标。

## 三、图片查看器：react-photo-view

选它的原因见末尾。集成要点：

- 只换显示层，保留我们已经做好的模态语义：`role=dialog`、`aria-modal`、焦点约束、关闭后焦点还回缩略图、
  `data-modal` 让应用级快捷键让位。这些 react-photo-view 自己不做。
- 用受控模式 `PhotoSlider`：`images` / `index` / `onIndexChange` / `visible` / `onClose` 和我们现在的状态一一对应，
  不依赖它去扫描已挂载的缩略图，避开虚拟列表的坑。
- 每张图给 `originRef`，从原位放大由它接管；随后删掉我们为图片写的 `shot` / `lb-bg` 两条 View Transition 规则。
- `overlayRender` 放我们自己的计数、文件名、在浏览器里打开、关闭按钮。
- `loadingElement` / `brokenElement` 接我们的样式；列表里的失败重试保持现在的做法。
- 列表仍然按槽位取裁过的图，查看器取原图，这条不变。

**要验的**：触控板捏合缩放、拖拽平移、双击、旋转、Esc、左右键，以及它的键盘处理会不会和我们的全局快捷键打架。

## 四、输入框：Lexical，Discord 模型

**模型确定为 Discord 那套，不是 Slack 那套**：输入框是「纯文本 + 原子装饰」，不是所见即所得。
打 `**重点**` 在框里就显示带星号的字面文本，发出去才变粗；只有 @ 是色块。

理由是我们的消息要喂给 agent。显示层本来就在渲染时处理 markdown，输入框若改成所见即所得，
发送前还要反序列化回 markdown，agent 收到的字符串一模一样，多一层翻译没有收益还可能丢信息。

**实现**

- 依赖：`lexical`、`@lexical/react`、`@lexical/plain-text`、`@lexical/history`。锁精确版本。
- 纯文本模式，不装富文本插件，不做格式工具栏。
- @ 色块用 `TextNode` 的 `token` 模式（`setMode('token')`，Lexical 文档里的示例就是这句）：
  一次退格删掉整块，光标进不去，方向键跳过。比包一层 React 子树的 DecoratorNode 更快。
  样式和消息里渲染出来的 @ 完全一致：人是 `--user/--utint`，agent 是 `--agent/--atint`。
- 候选菜单用 `LexicalTypeaheadMenuPlugin`（已确认它检查 `isComposing`，打拼音时不会误弹），
  候选数据和现在的 `mentionables()` 复用。
- **序列化**：遍历编辑器状态产出 `{ text, mentions: 账号ID[] }`。文本里写 `@显示名` 给别的端看，
  `atUserList` 带精确的账号 ID。顺带修掉现在按名字文本匹配的 bug——两个人名字相近会认错，改名后历史也对不上。
- 保持不变：按会话存草稿、附件栏、引用条、Enter 发送、组字时 Enter 不发、Shift+Enter 换行、
  粘贴图片、拖放文件、agent 芯片行。`composerBus` 的接口不变，Stream 和 MainArea 不用改。
- 高度：contenteditable 自己会长，保留最多 8 行的上限，以及「量高之前先关掉过渡」那个修复。

**要验的**：真实中文输入法下三件事——打拼音时候选菜单会不会误弹、选完候选文字会不会重复、
组字途中按回车会不会误发。可以用调试协议的 `Input.imeSetComposition` 做成自动化检查。

## 性能验收

- 输入框：连续输入不掉帧；粘贴长文本不卡。
- 图片：列表滚动仍然只请求槽位尺寸；查看器缩放拖动跟手。
- 启动：新增依赖带来的解析时间实测一次。
- 所有动效继续只动 transform / opacity，并遵守系统的减弱动态效果设置。

## 选型依据

**图片查看器**（把候选包下下来实测，gzip 前的运行时文件合计）：

| 库 | 体积 | 说明 |
| --- | --- | --- |
| react-photo-view | 18 KB + 3 KB 样式 | 受控数组、从原位放大、缩放拖拽旋转、下拉关闭、加载与失败态、自带 portal |
| yet-another-react-lightbox | 204 KB | 模块化，缩放是插件 |
| react-zoom-pan-pinch | 328 KB | 只有缩放拖拽，没有灯箱 |
| photoswipe | 672 KB | 原生 JS，还要自己包一层 React |

四个都没有 React 19 的兼容隐患。

**输入框**（gzip 后的可比口径）：

| | Slate | Lexical |
| --- | --- | --- |
| 体积 | 103 KB（slate 44 + slate-react 39 + slate-dom 19 + history 1） | 约 65 KB |
| React 19 | ESM 入口零隐患（先前标的隐患是 UMD 调试包里夹带的 React 告警字符串，假阳性） | 零隐患 |
| 原子色块 | inline void 元素 | token 模式文本节点 |
| 组字相关代码量 | slate-react 109 处 | 23 处 |
| 维护 | 0.x 发了 243 个版本，三个包要版本对齐 | 0.50.0，Meta 维护 |

两个都可行。选 Lexical 是因为体积更小、只有一个包不用对齐版本、组字这块代码更收敛；
Slate 的 inline void 能在色块里放任意 React（头像、悬停卡片），真需要时再换底座，
Discord 模型和序列化设计不用动。

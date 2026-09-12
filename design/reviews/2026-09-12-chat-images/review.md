# 群聊发送与图片体验代码审查

审查日期：2026-09-12。代码基线：`746f5e2`，package 版本 `0.3.4`。本机 `/Applications/yptd.app` 的包内版本也确认是 `0.3.4`。本次只新增审查材料，没有修改产品代码或安装图片库。

结论：应先修复消息身份和滚动布局，再做图片加载反馈；图片查看器需要移到应用独立顶层。仅调整动画时长，无法消除这些结构性问题。

## 1. 现场验证

| 步骤 | 操作 | 结果 |
| --- | --- | --- |
| 1 | 查看已有群聊及图片缩略图 | 静态显示正常，未验证发送过程帧率 |
| 2 | 点击已有图片 | 明确异常：遮罩只覆盖主区，图片越过左侧栏边界，又被右栏和输入框覆盖 |
| 3 | 灯箱打开后连续按两次 Tab | 明确异常：焦点进入背景的 `H HALX / @HALX` 按钮，未被限制在图片查看器内 |
| 4 | 按 Esc | 图片关闭，回到原消息位置；焦点进入输入框 |

步骤 1：

![群聊原始状态](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-12-chat-images/01-chat.png)

步骤 2、3：

![图片查看器错位](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-12-chat-images/02-lightbox.png)

步骤 4：

![关闭图片后恢复消息界面](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-12-chat-images/03-closed.png)

截图均在本次审查中获取、落盘并重新打开核对。键盘焦点结果见 [ui-observations.txt](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-12-chat-images/ui-observations.txt)。操作只查看已有消息，没有向真实群聊发送测试消息或上传附件。

## 2. 按优先级排列的发现

### F1 · P1：确认发送成功会改变消息 key，重新播放入场动画

证据：[session.ts:162](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:162)、[session.ts:178](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:178)、[rows.ts:41](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/rows.ts:41)、[Stream.tsx:159](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:159)。

文字和附件都先创建 `local_<time>_<seq>`，成功后 `remove(local.id)`，再插入 SDK 回显的 `clientMsgID`。行 key、React key、虚拟列表的 `getItemKey` 都直接使用消息 ID。

因此同一条消息经过的是“卸载旧行 → 挂载新行”，而非原位更新发送状态。新行无法复用旧 key 的量高缓存；通常又满足 `motionOf()` 的 fresh 条件，重新执行透明度从 0、向上 10px 的入场动画。底部还会因为最新消息 ID 改变，再调用一次 `scrollToBottom(false)`。这条链路直接解释了“先上屏，再闪动/动一下”。

修复：从提交到确认使用稳定的客户端渲染标识，将服务端 ID 映射到同一个实体；回显原位合并。业务引用、撤回仍使用真实消息 ID。也可在合适阶段利用 SDK 创建出的稳定 clientMsgID，但附件发送需要保留立即上屏能力。入场标识只消费一次；确认发送不能再次视为新增消息。

置信度：代码确定；实际发送时多大幅度掉帧尚无性能录制。

### F2 · P1：灯箱被动画祖先限制，遮罩和图片使用了不同的尺寸基准

证据：[App.module.css:16](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/App.module.css:16)、[Stream.tsx:359](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:359)、[Lightbox.module.css:2](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.module.css:2)。现场已复现。

灯箱嵌在 Stream 内，祖先 `MainArea` 带 `rl-rise ... both` 启动动画。虽然最后一帧的 transform 是 none，forwards/both 填充的动画仍要求浏览器按相应的 will-change 处理；transform 会建立 fixed 定位的包含块。结果是灯箱的 `fixed; inset:0` 实际以主区为基准，而图片的 `92vw / 86vh` 仍使用整个窗口尺寸。

Stream 自己的 opacity 动画和主区/右栏的启动动画还建立层叠上下文，内部的 `z-index:60` 无法突破祖先。截图中的遮罩范围、图片越界、右栏和输入框覆盖都符合这一机制。[CSS Animations 规范](https://drafts.csswg.org/css-animations/#animations)、[CSS Will Change 规范](https://drafts.csswg.org/css-will-change/#will-change)。

修复：把查看器 portal 到 `document.body` 下独立 overlay root，避开布局和启动动画祖先；用同一查看器容器计算遮罩与图片大小。启动动画结束时清理动画效果，避免长期保留 transform 的副作用。全窗口模态查看时，背景一致变暗并停止交互。

### F3 · P2：图片查看器没有完整模态交互，键盘可以操作背景

证据：[Lightbox.tsx:5](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:5)、[App.tsx:39](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/App.tsx:39)。现场验证 Tab 进入背景按钮。

当前只有 img、背景点击关闭和全局 Esc 监听，没有显式关闭按钮、dialog/aria-modal 语义、焦点约束，也没有统一阻止应用级快捷键。背景仍可被键盘操作；用户正在看图时，切会话等全局动作也没有读取灯箱状态。

修复：明确关闭控件、模态语义、焦点限制和关闭后焦点恢复；把灯箱状态纳入应用快捷键仲裁。图库至少提供上一张/下一张、计数、缩放、拖动、适应窗口和 1:1 查看。截图本身不能证明完整无障碍合规，本次另有键盘焦点实测。

### F4 · P2：滚动补偿把正在阅读的长消息也当作“视口上方的行”

证据：[Stream.tsx:182](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:182)。

当前条件仅为 `item.start < scrollOffset`。一条长 agent 消息横跨视口顶部时，只要顶部已经滚出屏幕，就满足条件；其底部继续增长也会补偿 scrollTop，将正在阅读的内容向上推。这里覆盖了虚拟列表默认判断。本次安装的 virtual-core 3.17.9 对重新量高已区分“整行完全在视口上方”和“行横跨视口”，当前自定义条件丢掉了这种保护。

同时贴底 effect 只依赖 `total` 和 `rows.length`；输入框的高度过渡改变消息区 clientHeight，却不一定改变这两个值。长文本发送后输入框收缩，滚动边界仍可能经历额外调整。

修复：统一管理“跟随底部”和“阅读历史”的滚动意图；阅读模式只补偿真正位于阅读锚点之前的尺寸变化，处理首次估高时另作区分。跟随模式同时响应内容尺寸和视口尺寸，避免用户正在上翻时被程序重新拉到底。不要直接把 smooth scroll 加到每次量高修正上。

置信度：分支行为由代码确定；输入框与消息区的逐帧偏移还需本地模拟发送验证。

### F5 · P2：消息缩略图仍请求原图，CSS 缩小没有减少下载和解码量

证据：[translate.ts:120](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/im/translate.ts:120)、[Stream.tsx:519](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:519)、[Stream.tsx:561](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:561)、[model.ts:64](/Users/antai/Development/personal/yptd-desktop/src/shared/model.ts:64)。

原生图片消息优先选 sourcePicture，然后把其余尺寸版本丢弃；富文本附件也只存一个上传 URL。消息列表和灯箱复用这个 URL。`width:200px`、`object-fit:cover`、`loading=lazy` 可以影响显示或何时请求，不能把原图变成小图。

本机发图后会直接请求刚上传的远程图；其他人和重启后的自己没有本地 preview 缓存，首次显示要等完整资源下载/解码。大图多时，此路径会放大等待和内存压力，但本次未测真实网络耗时，不能归因为服务器慢。

修复：图片模型区分 `thumbnailUrl / displayUrl / originalUrl`，保留 OpenIM 已有 snapshot/big/source；自定义附件补充持久化缩略图地址或服务端缩图。列表按实际槽位与 DPR 选资源，灯箱按需加载更高清版本。历史数据兼容回退原 URL。解码完成后在固定尺寸框内替换，避免布局跳变。

### F6 · P2：上传、消息确认和图片加载混在一起，已有淡入只覆盖一小部分场景

证据：[session.ts:183](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:183)、[files.ts:22](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/im/files.ts:22)、[Stream.tsx:543](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:543)、[Stream.module.css:187](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.module.css:187)。

多附件按 `for + await` 串行上传，所有文件传完才发送 IM 消息。界面只看到 sending，图片固定 opacity .78，没有持续的上传反馈。本地预览 URL 到远程 URL 的映射存在时，才会给远程 img 加淡入；历史图片、收到的图片没有同等反馈。img 只有 onLoad，没有 onError/重试。远程资源失败时，本机可能一直停留在缩略图，其他端只能看到坏图。

修复：独立维护上传阶段与显示资源阶段。上传中的图片保留清晰可辨认的本地预览，叠加轻微渐变扫光与状态文字；有经实际验证的 SDK 字节进度才显示百分比，否则显示不定进度。消息确认后移除上传遮罩，远程图片未加载完也不应继续显示“发送中”。远程图加载/解码完成后 150–220ms 交叉淡入；失败保留预览，显示重试。

附件可采用 2–3 个受控并发槽位，保留原数组顺序；是否收益需按实际带宽验证。动画仅覆盖图片槽位，使用 transform/opacity 并遵守减少动态效果设置。

### F7 · P2：附件估高假设与真实换行规则不一致

证据：[Stream.tsx:38](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:38)、[Stream.tsx:61](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:61)、[Stream.tsx:547](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:547)、[Stream.module.css:183](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.module.css:183)。

估高按每行最多 4 张计算；实际是按图片比例决定宽度的 flex-wrap。两张横图可各宽 400px，即使 gallery 最大宽度 760px 也放不下一行，实际高度会接近两行，估高却只算一行。传统 Gallery 的估高还固定使用 180px，与真实 200/150px 不同。

量高之后会修正，但修正幅度越大，F1 的重新挂载和贴底调整越明显。应让布局和估高共用一个按可用宽度、比例、间距计算的排布函数，或采用明确列数的网格。固定图片槽位是正确方向，现有 natural 元数据可以直接复用。

## 3. 其他相关风险

- **滚回历史仍可能重播入场。** `motionOf` 长期保留 enterDelay，后来到达的消息长期满足 fresh；虚拟化卸载后重新挂载仍带动画 class。应记录动画是否消费过，而不是以“是否晚于首次打开”判定是否该播放。
- **图先发、文字后发，图上传完成时可能重新排序。** `sendRich` 在上传之后才 composeText；其间文字可先提交到 SDK。回显重新进入按 sentAt 排序的 Timeline，图片可能从原占位移到文字后方。需要明确消息队列/服务端排序策略，稳定 key 本身不保证顺序稳定。不能用假本地时间永久掩盖服务端顺序。
- **失败回填会覆盖新草稿。** [Composer.tsx:79](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Composer.tsx:79) 对旧消息的失败执行 setDraft/setAttachments，可能覆盖用户已输入的新内容；切走会话后则没有接收恢复事件的 Composer。建议保留失败消息和附件，提供原位重试，而不是删除气泡再强制恢复输入框。
- **图片缓存没有释放策略。** previews Map 只有 set/get，没有容量上限、退出清理或淘汰；data URL 持续驻留。可采用按会话/容量管理的 LRU，在远程资源可用且安全回收后释放本地预览。
- **缩略图准备发生在主进程同步路径。** [main/index.ts:126](/Users/antai/Development/personal/yptd-desktop/src/main/index.ts:126) 同步创建 nativeImage、缩放、编码；批量文件要全部 probe 完才更新附件栏。大图准备存在主进程阻塞风险，应先占位并逐项填充，将重处理移入适合的异步/独立工作路径。尚未测得该阶段耗时。
- **全局 tick 导致无关会话更新触发当前流 buildRows。** 虚拟化限制了 DOM 数量，但没有限制每次 tick 对整个已加载时间线的遍历。建议按 conversation 订阅版本，并让变化范围可定位；需要 profiling 后决定是否进一步做增量 rows。

## 4. 图片查看器选型

以下为官方文档与源码核查后的适配判断，尚未在 Electron 内集成比较手势性能。

| 方案 | 与本项目相关的能力 | 集成判断 |
| --- | --- | --- |
| [Yet Another React Lightbox](https://yet-another-react-lightbox.com/documentation) + [Zoom](https://yet-another-react-lightbox.com/plugins/zoom) | body portal、受控 slides/index、响应式图片、加载/错误呈现定制；Zoom 覆盖触控板、鼠标和键盘 | 首选验证方案。React 状态接口适合现有架构，源码 peerDependencies 明确包含 React 19。需接入应用快捷键与内部滚动区域，不能只依赖 body 滚动锁 |
| [PhotoSwipe](https://photoswipe.com/getting-started/) | 缩略图开合、裁剪缩略图过渡、占位图、响应式资源、缩放 | 若首要目标是“从原位置顺滑放大”，优先考虑。要求预先知道图尺寸；现有 natural 大多可用，但历史 null 要兜底。虚拟列表用 [dataSource](https://photoswipe.com/data-sources/) 驱动图库 |
| [react-photo-view](https://react-photo-view.vercel.app/docs/api) | body portal、自定义 loading/broken、缩放/旋转与覆盖层接口 | 适合精简预览。正式采用前重点验证 React 19 的 ref 行为、焦点隔离和虚拟列表卸载后图库稳定性 |

YARL 的 React 19 依赖支持以[官方 package.json](https://raw.githubusercontent.com/igordanchenko/yet-another-react-lightbox/main/package.json)为据；支持声明不能代替在 Electron 33 中的实测。

无论选哪个库，都应在 Stream 外维护独立查看器状态：点击时构造稳定的图片数组和当前索引；不能仅扫描已挂载的虚拟列表 DOM，否则只能翻当前屏附近的图。聊天 tick 不应不断重建 slides、重置索引。预加载只取邻近少数图片。

初版建议查看范围为当前消息的附件组；再扩展到当前会话已加载图片。关闭后回到原消息位置；原缩略图已卸载时以淡出收尾，避免向失效 DOM 做缩回动画。选用库自身动画后，应移除现有 shot/lb-bg 的重复 View Transition 驱动。

## 5. 建议实施顺序与验收

1. **先稳定消息身份和滚动。** 修 F1/F4/F7，明确发送顺序及失败保留策略。正常/延迟回显时 DOM 节点身份保持；发送确认不重播动画；多行输入发送、两张横图、连续发图、读历史时收消息都验证。
2. **建立完整图片资源状态。** 修 F5/F6，先本地预览和固定槽位，再上传遮罩，确认成功后单独等待远程清晰图。覆盖慢上传、慢下载、缓存命中、图片 404、重试、退出重进，以及减少动态效果。
3. **替换独立顶层查看器。** 优先小范围验证 YARL + Zoom；如开合动效仍不满足要求，再比较 PhotoSwipe。覆盖窄窗口、右栏开合、1x/2x DPR、长截图、横图、超大图、连续切图、缩略图已卸载、Tab/Esc/应用快捷键。
4. **再按数据优化。** 记录提交到本地首帧、上传、消息确认、远程图 load/decode 各阶段耗时，记录 scrollTop/clientHeight/行 key 和长任务；目标是在延迟回显和弱网下保持内容稳定。没有测量前不承诺 60fps 或具体加速比例。

## 6. 已完成检查与边界

- `npm test`：6 个文件，67 个测试全部通过。
- `npm run typecheck`：通过。
- 查看并记录了实际应用中的图片错位、键盘焦点穿透、Esc 恢复。
- 现有测试使用 Node 环境，主要覆盖模型、翻译和状态逻辑，没有发送过程的 React DOM/布局/动效集成覆盖；全部通过不代表这些体验问题不存在。
- 没有向真实群聊发送测试内容，没有抓取上传网络性能，没有运行替换图片库后的实测；消息抖动的具体帧耗时和各性能因素占比仍需隔离环境验证。

---

## 7. 复核与第一批修复（2026-09-12，`746f5e2` 之后）

复核方式：在开发版上用变更观察器和 `animationstart` 计数做前后对照，而不是只读代码。审查里的 17 处行号引用逐条核对，全部准确。

### 复核修正

- **F2 的机制要改。** 原文归因于 `will-change` 处理。实际原因是：以 `both` 填充 `transform: none` 时，计算值落成单位矩阵 `matrix(1, 0, 0, 1, 0, 0)` 而不是关键字 `none`，单位矩阵照样建立包含块。隔离测试：`both` 结束后残留单位矩阵，`backwards` 与不写 fill 都回到 `none`。因此不需要「用 JS 清理动画效果」，改填充模式即可。
- **`view-transition-name` 不是元凶。** 遮罩几何等于 `main` 而非 Stream 容器，说明 Chromium 130 下它没有建立包含块。
- **F5 的修复可以更轻。** 服务端本来就有缩图接口，`?type=image&width=W&height=H`，对自有上传的附件同样生效，只给宽高不带 `type` 会返回原图。900×500 的图请求 200px：116501 字节降到 7953。先在渲染处按槽位拼参数就能拿到绝大部分收益，模型拆三个地址可以后置。

### 审查遗漏

- **表情选择器与「更多」菜单同样错位**，同一个包含块。弹层内联样式 659/670，实际渲染 983/718，偏移量正好是主区原点 324/48；遮罩也只盖主区，点侧栏关不掉。
- **回应芯片每次被虚拟列表回收再挂载都重播弹簧动画。** 上下滚一趟触发 24 次入场动画，其中 18 次是芯片。这是滚动不流畅的独立来源。
- 以上两处与 F2 都是 0.3.4 的回归，来自该版新增的启动编排动画。

### 本次已修

| 改动 | 位置 |
| --- | --- |
| 全部应用元素的动画填充 `both` 改 `backwards`，过渡伪元素保持 `both` | `src/renderer/src/**/*.css` |
| 消息身份改用 SDK 创建时分配的 clientMsgID，回显原位更新 | `store/session.ts` |
| `absorb` 对原位替换也触发重绘 | `store/session.ts` |
| 入场动画播完记账，回收再挂载不重播 | `views/Stream.tsx` |
| 去掉回应芯片的无条件入场动画 | `views/Stream.module.css` |
| 新增填充模式的防回归检查 | `motion/fill.test.ts` |

实测对照：

| 指标 | 修复前 | 修复后 |
| --- | --- | --- |
| 一条消息的挂载次数 | 2 | 1 |
| 一条消息的入场动画次数 | 2 | 1 |
| 发送后 107ms 内的滚动跳变 | 3 | 1 |
| 上下滚一趟的入场动画数 | 24 | 首趟 10，之后 0 |
| 灯箱遮罩 | 324,48,744,852 | 0,0,1440,900 |
| 表情弹层 | 偏移 324,48 | 与内联样式一致 |

回归覆盖：纯文本、带引用、带 @、文字加两图一文件、只发图不打字、发送失败回填，均在真实群聊验证并撤回测试消息。

### 未做

F4 滚动补偿、F5 缩图接入、F6 上传阶段反馈、F7 估高、F3 灯箱模态语义与换库，均未动。下一步建议按 F5、F7、F4、F3 的顺序，F5 收益最大且改动最小。

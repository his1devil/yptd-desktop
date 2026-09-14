# 2026-09-14 代码 Review

审阅范围：`762f342..af0bf3c`，今天 8 个提交；当前版本 v0.5.0。审阅开始时工作区干净，期间新增的 `af0bf3c` 只修改版本号，已纳入范围。重点检查消息发送、媒体加载、成员及历史分页、频道设置、搜索、托盘和窗口生命周期；同时检查了相关样式、构建与发布脚本。没有修改产品代码或执行发布。

结论：2 个 P1、7 个 P2。最需要先修的是跨群设置串状态和并发发送的失败回填。上一轮头像尺寸分档、图片控件层级、退出动画、会话独立分页状态等修复有效，但渐进图片加载和大群加载仍有边界问题。下面区分源码确认与隔离用例复现；未把请求链长度当成真实网络耗时，也未重新测生产服务的带宽。

**1. P1：切换频道后可能把上一频道的隐私开关写入当前频道**

位置：[InspectorTabs.tsx:113](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/InspectorTabs.tsx:113)，关联 [Inspector.tsx:103](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/shell/Inspector.tsx:103)。引入：`0750564`。

`ChannelSettings` 没有按 groupID 设置组件 key；groupID 改变时也没有清空 `policy`、`err`。右栏的 settings 页签可以保留到下一个群，所以 A 的 policy 会继续参与 B 的渲染，直到 B 的 groupInfo 成功返回。若 B 的权限信息已在成员缓存里，开关在这段时间仍可编辑。

触发例：A 的 findable/joinable 都为 true，B 的实际状态都为 false；从 A 设置切到 B，B 的 groupInfo 尚未返回时关闭“允许自己加入”。`flip()` 会把 A 的 findable=true 和本次 joinable=false 一起发给 B，意外开启 B 的可搜索性。若 B 的读取失败，这个窗口会持续存在。A 尚未结束的保存请求失败，也会在 catch 中把旧 policy 回滚到 B 的组件状态。

建议：让设置状态显式归属 groupID；换群立即进入不可编辑的加载状态，或按 groupID 重挂组件；读取及保存回包都校验当前群和请求版本。验收要包含“两个群的成员已缓存、设置读取乱序、读取失败、保存期间切群”。这是源码调用链确认，未向真实频道写入配置。

**2. P1：图片上传期间继续发送，前一条失败会回填成后一条的文字和 @**

位置：[Composer.tsx:94](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Composer.tsx:94)，关联 [Composer.tsx:110](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Composer.tsx:110)、[session.ts:243](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:243)。引入：`cf68732`。

新增的 `attempted.current` 只保存“最近一次发送”的 Segment。附件发送走 `sendRich` 后立即返回，不设置 `sending`，因此同一会话可以有多个尚未结束的发送。发送 A（@Alice + 图片）后发送 B（@Bob + 文字），B 会覆盖这个 ref；A 的上传稍后失败时，restore 收到的是 A 的附件和 quote，却使用 B 的 Segment 回填编辑器。A 的正文丢失，重新发送还可能重复 B 的内容或 @ 错人。

建议：在每次发送操作中保存完整草稿快照，并让 restore 携带该操作对应的 Segment/mentions，而不是从组件级单槽 ref 读取。可在 SDK 分配 clientMsgID 前使用本地 operationID。验收包括 A/B 交叉成功与失败、连续两条图片、失败前切换会话；不要以阻止继续输入来掩盖草稿归属问题。此项为源码异步时序确认。

**3. P2：历史分页的防重复标记会持续阻止后续加载**

位置：[session.ts:698](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:698)，关联 [session.ts:208](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:208)。修改：`867ce01`；属于本轮历史修复仍未覆盖的路径。

`added === 0` 就把循环结束时的 olderCursor 写进 stalledAt，下次 loadOlder 遇到相同游标直接返回。但“没有可展示消息”不等于“游标没前进”：连续 5 页都是被过滤的系统通知/回应时，循环已前进 5 次，代码却封住了下一页尚未请求的游标。SDK 暂时返回 `isEnd=false` 的空页，也会让这次临时状态变成持续不可重试。

正常 open/ensure 不会重新加载 ready 时间线；同步完成时只重试完全没有消息的时间线，已经有正文的会话不能靠它解锁。两个隔离用例调用真实 session store，分别确认：第二次 loadOlder 没有再调用 SDK；游标确实前进过、hasMore 仍然为 true，也依然被挡住。

建议：分别记录“预算耗尽但游标前进”“游标未前进”“明确 isEnd”。预算耗尽应允许下一轮继续；临时无进展应有退避/显式重试及同步后恢复路径。验收用 5 页以上过滤消息夹在两段正文中，并测试空页后 SDK 恢复数据。

**4. P2：图库超过 3 张时，清晰度升级会重建查看器并重置缩放/位置**

位置：[Lightbox.tsx:128](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:128)，关联 [Lightbox.tsx:72](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:72)。引入：`867ce01`。

已核对当前安装的 react-photo-view 1.2.7 自带 source map，非凭文档推测：PhotoSlider 默认 `loop=3`，实际启用条件是 `images.length > 3`；循环模式下 PhotoBox 的 React key 包含 `item.src`。因此外层给 `key: p.url` 仍不足以稳定组件。缩略图升级为显示图、显示图升级为原图，都会改变内部 key，重新初始化 scale=1、rotate=0、x/y，用户刚做的缩放拖动会丢失。这也是渐进加载重新产生跳变的具体原因。

即使关闭循环，库的 handlePhotoLoad 仍按新图片尺寸重新计算 x/y，因此单纯添加 `loop={false}` 只能去掉这条重挂路径，不能保证平移位置不动。两级图片尺寸较小时，“×1”对应的实际显示尺寸也可能变化。

建议：先明确采用首尾停止还是循环浏览；当前按钮已经是首尾停止，可显式关闭 loop。进一步让图像内容升级与视图变换状态分离：保存并恢复缩放、旋转与归一化焦点，或选择明确支持多分辨率图像替换且保留变换的适配方式。验收至少使用 4 张图，先放大/拖动/旋转，再让后台显示图完成和点击原图。此项由应用代码及已安装依赖源码确认，未做本次实机手势回放。

**5. P2：图片异步升级可乱序降级，失败还会替换掉已经可看的图片**

位置：[Lightbox.tsx:68](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:68)，关联 [Lightbox.tsx:117](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:117)。引入：`867ce01`。

每次 swap 都启动一个 Image.decode，完成回调无条件写 srcs，没有请求版本或清晰度优先级校验。显示图请求尚未完成就点原图，若原图先完成（例如原图已缓存），旧的显示图随后完成会把原图覆盖为低清图；full 集合仍认为原图已请求，按钮也已经消失。

此外 `.then(done, done)` 在解码失败时同样替换 src。于是本来有效的缩略图会被失败目标取代。库进入 broken 状态后，这个界面只有错误文字，没有可直接重试原图的入口；“下载中/成功/失败”都混在 full 这个集合中。

建议：按图片维护目标级别、请求序号、pending/ready/error；只允许当前有效请求成功后升级，失败保留当前可见图并提供重试，较早的低清请求不得覆盖已成功原图。快速翻图时去重或限制后台请求，避免离开的图继续挤占当前图带宽。此项为源码异步时序确认，未把可发生的乱序写成必然发生。

**6. P2：大群成员先全量串行获取再显示，头像和 @ 候选一起等待；超过 2,000 人仍静默截断**

位置：[session.ts:335](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:335)，关联 [session.ts:352](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:352)、[Inspector.tsx:189](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/shell/Inspector.tsx:189)。修改：`867ce01`。

分页扩展了原来的 200 人范围，但每页 await 串行获取，并在全部结束后只 set 一次。第一批 200 人已可用，仍要等下一页；2,000 人最多形成 10 次串行 SDK 等待，第一屏成员及头像无法提前显示。本轮 @ 候选又严格依赖当前群 members，因此该延迟同时影响输入。任何后续页失败都会使本轮已拿到的前面页无法提交。

随后 loadAvatars 把全部成员 ID 一次交给 im.users，没有分批或跨群去重。右栏自身仍全量 map 成员；图片 lazy loading 不会减少成员 DOM 数量。这里确认的是调用顺序和工作量，未测大群真实服务时延或声称 SDK 拒绝大批量 ID。

两个隔离用例确认：第一页返回后、第二页悬挂时 members 仍未写入；模拟 2,050 人时，只调用 10 页，最终名单只有 2,000 人，随后一次 im.users 接收 2,000 个 ID。后 50 人既不展示也不会成为 @ 候选，界面没有“部分成员”的说明。

建议：第一页就提交并显示；后续分页增量合并，失败保留成功页，暴露 hasMore/error。可见成员优先加载头像/资料，再小批补齐；大群名单虚拟化。若要保留资源上限，应明确局部列表语义，并提供分页或服务端成员搜索，不能把局部成员数展示为完整名单。

**7. P2：关闭窗口后托盘还在，未读数却停止更新**

位置：[App.tsx:36](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/App.tsx:36)，关联 [main/index.ts:279](/Users/antai/Development/personal/yptd-desktop/src/main/index.ts:279)、[main/index.ts:307](/Users/antai/Development/personal/yptd-desktop/src/main/index.ts:307)。引入：`20ae3d4`。

唯一的未读推送来自 React App 中的 session store 订阅。关闭按钮调用 BrowserWindow.close，close 处理器仅保存窗口尺寸，没有 preventDefault 后 hide。macOS 上 window-all-closed 不退出主进程，托盘仍存在，但渲染进程和订阅已销毁。主进程即使仍有 OpenIM 实例，也没有独立统计并调用 setUnread 的链路；新消息不能刷新托盘数字，直到重新打开窗口并同步会话。

建议：明确关窗语义。若应用继续驻留收消息，则普通关闭保留隐藏窗口、真正退出才销毁；或将未读状态维护下沉到常驻主进程。修复后分别验证关窗、隐藏、最小化、重新打开、真正退出。此项为进程生命周期调用链确认，没有关闭用户正在使用的窗口。

顺带的性能问题：当前 subscribe 监听整个 session，任何 tick、notice、头像或成员更新都会重算全部会话并发 IPC，甚至 count 未变也会调用托盘/Dock API。可订阅 conversations 并对最终 count 去重；这属于附加优化，不计为独立高优先级缺陷。

**8. P2：隐私页承诺“完整 ID 找人”，但新接口没有接入任何入口**

位置：[api.ts:99](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/im/api.ts:99)，关联 [CommandPalette.tsx:122](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/CommandPalette.tsx:122)、[Settings.tsx:320](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Settings.tsx:320)。引入：`0750564`。

api.lookup 已定义，但全项目搜索未找到调用方。⌘K 找人仍仅过滤 roster + 已加载群成员；远端查询只接了频道目录和消息搜索。对关闭 discoverable、没有邀请关系、也不在已加载群成员缓存中的用户，输入完整 ID 仍不能找到。隐私页却明确告诉用户完整 ID 可作为联系途径。

建议：在明确的完整 ID 查询路径调用 lookup，并将返回用户接入会话标题、头像和打开私聊流程；不要用昵称模糊搜索绕过 discoverable。需要查询中的状态、未找到反馈以及防止旧请求覆盖新查询。此项通过全项目调用搜索和 UI 数据源确认；未验证服务端 lookup 的权限实现。

**9. P2：表格内转义竖线被拆成列，后面的真实内容被丢掉**

位置：[markdown.ts:88](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/markdown.ts:88)，关联 [markdown.ts:81](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/markdown.ts:81)。引入：`20ae3d4`。

cells 使用 split('|')，不识别单元格中的 `\|`；多余列又被无条件截断。实际调用 blocks 的隔离用例输入如下：

```text
| 表达式 | 描述 |
|---|---|
| a\|b | 选择之一 |
```

解析结果的两个单元格变成 `a\` 和 `b`，真正的“选择之一”不再出现在结果中。这是显示内容丢失，会影响 agent 输出的正则、命令和表达式表格。

建议：按转义状态扫描分隔符并处理字面竖线；若无法可靠解析，回退原始文本，避免静默截断有效内容。验收覆盖转义竖线、反斜线、空单元格和代码格式内的转义符。

**验证记录与边界**

- 项目现有 `npm test`：16 个文件、164 个测试通过。
- `npm run typecheck`：通过。
- `npm run build`：通过；v0.5.0 构建完成，未打安装包或发布。
- [session.probe.test.ts](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-14-changes/session.probe.test.ts)：4 个复现用例通过，使用真实 session store，替换 SDK 调用，无登录、发消息或上传。
- [markdown.probe.test.ts](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-14-changes/markdown.probe.test.ts)：1 个内容丢失复现用例通过。
- 这些 probe 的断言描述的是当前缺陷，因此“通过”表示成功复现，不表示功能正确。修复后应改写为期望行为的正式回归测试。
- 查看器依赖分析来自当前安装的 `node_modules/react-photo-view/dist/react-photo-view.js.map`，版本 1.2.7；未推断其他版本的实现。
- 没有用真实账号切换隐私配置、发送故障消息或关闭用户窗口；频道/发送/图库/托盘的结果来自源码调用链，尚需对应交互回归。服务端钩子与权限规则不在本仓库验证范围内。

复现命令：

```sh
npx vitest run --config design/reviews/2026-09-14-changes/vitest.config.ts
```

建议修复顺序：先解决 1/2 的数据归属问题，再补 3 的分页恢复、4/5 的查看器状态，随后处理 6 的大群加载、7/8/9 的功能缺口。现有测试多覆盖解析和纯函数；缺的主要是组件状态归属、异步回包顺序及进程生命周期验证。

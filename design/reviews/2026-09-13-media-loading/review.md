# v0.3.5 图片、头像与历史消息加载复核及方案

审查日期：2026-09-13。代码基线：`762f342`，应用与安装包均为 v0.3.5。范围：查看器、消息图片、成员头像、会话进入与历史分页；本次只新增分析材料，没有修改产品代码。

**结论：上一轮对消息身份、布局和滚动的修复应保留。当前剩余问题集中在查看器集成不完整，以及资源规格、请求顺序、缓存策略未形成一致的设计。实测证明，头像请求原文件和大图下载量是主要可优化项。**

## 1. 已改善的部分与本次证据

- 乐观消息沿用 SDK 的 `clientMsgID`，回显更新原行，避免临时 ID 换正式 ID 导致重挂。
- 图片预先占位，列表走 `sized()`；多图已有固定布局、本机预览铺底、加载/失败状态，上传并发限制为 3。
- 恢复虚拟列表默认的尺寸变化补偿，使用 ResizeObserver 跟随底部；保留这些修改，不重新引入第二套滚动补偿。
- 查看器已采用 `react-photo-view@1.2.7`，portal 到 body，原来的祖先 transform 导致模态定位异常已不是本次主因。

本次检查了项目源码、安装依赖的 source map 中的实际源码，以及 `/Applications/yptd.app` 的已有聊天图片。双击放大有效，减号快捷键没有缩小；图片就绪前显示“加载中…”，放大后关闭按钮和操作条不可见，Esc 可以退出。没有发送消息或上传图片。

截图：[等待原图](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-13-media-loading/viewer-loading.png)、[原图就绪](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-13-media-loading/viewer-fit.png)、[双击放大](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-13-media-loading/viewer-zoomed.png)。这些是实机观察；没有录制精确开图计时，也没有实测物理触控板的捏合手势。

校验：现有 10 个测试文件、91 项测试通过；TypeScript 检查通过。现有测试不等同于覆盖了查看器层级、网络缓存、触控板或过滤后空页等行为。

## 2. 关键发现

### F1 · P1：查看器自己的图片层盖住了自定义控件

位置：[Lightbox.module.css:10](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.module.css:10)、[Lightbox.module.css:18](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.module.css:18)。

`.close`、`.bar` 的 `z-index` 是 2，库的 `.PhotoView__PhotoWrap` 是 10。自定义 overlay 的外壳没有建立更高层级。图片加载前能看到底栏；加载后只要图片覆盖底栏位置，底栏就被盖住；放大覆盖整个窗口后，右上关闭按钮也被盖住。实机截图与源码吻合。

修复：在实际 portal 内建立独立控件层，层级高于图片层；容器 `pointer-events:none`，按钮 `pointer-events:auto`。不要只提高 `.shell` 的 z-index，它与 portal 不是 DOM 祖孙关系。`.shell .PhotoView-Portal` 这个后代选择器也匹配不到实际 portal。

### F2 · P1：缩放并非完全没有实现，而是桌面操作入口与部分边界缺失

位置：[Lightbox.tsx:54](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:54)、[Stream.tsx:149](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:149)。

当前集成存在以下具体缺口：

1. `bannerVisible={false}` 同时关闭库的 banner 和桌面左右翻图箭头。自定义 overlay 只有关闭、名称、外部打开，没有提供上一张/下一张、放大/缩小、复位、倍率、旋转。
2. 库公开了 `scale/onScale/rotate/onRotate`，应用没有接入。安装版只处理左右箭头翻图和 Esc；没有 `+/-/0` 缩放复位。实机按减号图像不变。
3. 安装版 wheel 处理直接使用 `scale - deltaY / 200`，没有区分 Ctrl/捏合缩放和普通滚动，也不使用横向 `deltaX` 或规范化 `deltaMode`。这与“放大后双指滚动平移”的桌面预期不一致；具体 macOS 捏合事件表现仍须硬件验收。
4. 最小倍率硬编码为 1，表示相对初始显示尺寸。对于宽高均超过视口、纵横比至少 3 的长图，初始走适应宽度，无法缩到整张适应视口。例如 2000×10000 的长截图会触发此路径。这个限制不能仅靠 `onScale(0.5)` 绕过，公开控制也会被钳制回 1。
5. 关闭时直接 `setShot(null)` 卸载，库没有经历 `visible=false → afterClose`，关闭过渡无法完整执行。

检查依据：安装版 `PhotoSlider.tsx`、`PhotoBox.tsx`、`getSuitableImageSize.ts`、`limitTarget.ts`、`variables.ts`；公共扩展接口见 [react-photo-view API](https://react-photo-view.vercel.app/docs/api)。

另有语义问题：焦点放在空的 shell，实际按钮在 body 下另一个 portal 内。实机 AX 树只暴露“查看图片”的壳，没有暴露其中操作。应把模态命名、初始焦点、焦点循环与背景隔离放到承载真实内容的同一层。安装版 portal 本身已有 `role=dialog`，源码注释声称库不设 role 并不准确。

### F3 · P1：开图直接等原图，且图库会并行取相邻原图

位置：[Lightbox.tsx:8](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:8)、[Lightbox.tsx:58](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Lightbox.tsx:58)、[Stream.tsx:626](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:626)。

消息中的自然尺寸和缩图资源到了 `Pic` 就只剩 `url/name`。灯箱 `src: p.url` 直接请求原图，列表已加载的缩图、发送端本机预览均未作为灯箱的内容占位。`originRef` 只供开合动画读取矩形，不负责把已加载缩图显示为大图预览；库的开场动画还要等待目标图片加载。

安装版 `useAdjacentImages()` 会挂载当前图和相邻图，最多 3 张；各自的 `<img>` 立即加载 `src`。因为当前传入的全部是原图，多图图库会提前消耗原图带宽与解码内存。打开单图时不存在相邻下载，不能把这项解释套在所有场景上。

实测样本原图为 5712×3799、3,830,755 字节，约 15 秒下载完成。若按每像素 4 字节估算，一张解码像素缓冲就约 83MiB；这是估算，不是本次测得的进程内存。高分辨率图同时解码和缩放会进一步扩大资源压力。

### F4 · P1：26px 头像请求完整文件，成员资料还被历史消息串行阻塞

位置：[Avatar.tsx:57](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/components/Avatar.tsx:57)、[Inspector.tsx:156](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/shell/Inspector.tsx:156)、[session.ts:159](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:159)。

`Avatar` 直接 `<img src={src}>`，完全没有复用列表图片的缩图逻辑。右栏实际显示 26 CSS px，却下载最高超过 1200px、超过 1MB 的文件。头像 URL 一旦存在就移除字形占位，下载期间留下空色块，失败也没有恢复字形。

进入尚未缓存成员的群聊时，主要路径是：

```text
切换会话 → await ensure(历史第一页) → loadMembers → 得到头像 URL → 下载完整头像
```

历史和成员并无这里要求的依赖，但被串行执行。SDK 同步初期成员为空时，`loadMembers()` 还固定等待 1500ms 再试。启动资料补全也在 `refreshConversations()` 完成后才调用 `loadAvatars()`。

因此要分别修复“成员资料何时可用”和“头像文件何时可显示”。只加 Avatar 的 `loading=lazy` 不能消除前面的串行等待；首屏可见头像也不应一律延迟加载。

### F5 · P2：成员缓存与历史加载还有规模和正确性问题

- [client.ts:63](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/im/client.ts:63)：成员只取 offset=0/count=200，没有后续分页。超过 200 人会显示不完整；右栏又对已取成员全部 `.map()`，没有视口加载限制。
- [Inspector.tsx:99](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/shell/Inspector.tsx:99)：右栏收起只变宽度，成员内容仍挂载。没有明确降低隐藏区图片加载优先级。
- [session.ts:264](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:264)：成员没有按群记录请求复用、状态、更新时间。错误、暂时空数据、真正空集合区分不足；缓存 `[]` 后，`open()` 的存在性判断会跳过再次加载。
- [Inspector.tsx:156](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/shell/Inspector.tsx:156)：右栏读取成员快照 `m.avatar`，消息区另读用户头像表。需要统一用户资料引用，保留群内昵称/角色等覆盖字段，避免两处头像更新不同步。
- **历史分页存在可构造的提前截断**：[session.ts:550](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:550) 用过滤后的 `msgs.length` 判定 `hasMore`。如果原始一页全部是回应/通知/未知自定义消息，[translate.ts:65](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/im/translate.ts:65) 会把它们全部过滤，即使 SDK `isEnd=false`，也会把后续历史判为结束。游标还来自最老的可见消息，而不是原始 SDK 页的边界。
- [session.ts:177](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/store/session.ts:177)：`loadingOlder` 是全局状态，A 会话的慢请求会阻止 B 会话加载历史。
- [Stream.tsx:100](/Users/antai/Development/personal/yptd-desktop/src/renderer/src/views/Stream.tsx:100)：每次全局 tick 都重新对当前已加载的全部消息做 `visible/buildRows`。虚拟列表减少 DOM 数量，但并没有限制这部分计算和跨会话内存增长。长时间使用时需单独做性能 trace 后确定优化收益。

## 3. 本次网络测量：优先减小资源，而不是延长动画

对当前群聊已有的 3 张头像和 1 张图片做只读 GET，顺序执行，跟随媒体入口到项目文件域名的跳转。curl 没有浏览器本地缓存；这些不是 Electron 冷启动/热启动的整体耗时，也不是统计 P95。缩图可能已由前面的请求生成或缓存。完整安全摘要见 [measurements.json](/Users/antai/Development/personal/yptd-desktop/design/reviews/2026-09-13-media-loading/measurements.json)，不保存签名 URL。

| 样本 | 原始规格 / 体积 | 原文件耗时 | 64px 缩图体积 | 缩图耗时 |
| --- | --- | ---: | ---: | ---: |
| 头像 A | 1066×936 / 343,407 B | 1.13s | 7,053 B | 0.34s |
| 头像 B | 1220×1212 / 1,416,131 B | 5.08s | 6,913 B | 0.37s |
| 头像 C | 946×940 / 1,192,153 B | 4.02s | 8,245 B | 0.30s |
| 合计 | 2,951,691 B | 不将顺序耗时当作界面耗时 | 22,211 B | 字节量减少 **99.25%** |

26px 在 2 倍屏需要约 52 物理像素，64px 档位已足够。服务保持原比例，样本缩图实际为 64×56 或 64×63，头像容器再做 `object-fit:cover`。

| 同一张聊天图片的请求 | 实际返回 | 字节量 | 首字节 / 完成 |
| --- | --- | ---: | ---: |
| 原图 | JPEG，5712×3799 | 3,830,755 B | 0.34s / 15.15s |
| 640px | PNG，640×425 | 435,290 B | 0.26s / 1.37s |
| 960px | PNG，960×638 | 905,131 B | 0.28s / 3.22s |
| 1280px | 返回同一原图，5712×3799 | 3,830,755 B | 1.05s / 15.09s |
| 2048px | 跳转到同一原图路径 | 未重复下载 | 仅检查跳转 |

由此得到四项需要落实的判断：

1. **当前服务不能按前端任意要求生成尺寸。** 同一样本 160/320/640/960 跳到缩图，1280/2048 跳到原文件；不能直接宣布服务上限恰好是 1024，仍需服务端配置/日志确认。`sized()` 当前最高允许 2048，HTTP 200 的原图回退不会触发 `<img onError>`。
2. **照片转成 PNG 后仍偏大。** 960px 的照片缩图接近 1MB，仍需 3 秒多。应对照片生成有损 WebP/JPEG，对文字截图按清晰度选择无损/高质量格式；不能只统一换扩展名。
3. **这一样本主要耗在下载。** 原图首字节约 0.34 秒，总耗时约 15 秒，不能把这 15 秒都归因于 React、动画或组件包体积。解码和渲染的具体占比需要另行 trace。
4. **缓存策略不明确。** 抽样的入口 302 和最终 200 均未见显式 `Cache-Control`，最终有 ETag/Last-Modified；302 指向带 `X-Amz-*` 参数的签名文件地址。缺少 Cache-Control 不等于完全没有缓存，Chromium 可能使用启发式缓存或条件请求。但应明确入口缓存期、签名有效期和内容版本，否则很难保证重复进入/重启后的命中行为。仅缓存最终文件也不必然省掉入口跳转。

样本文件名是 `.png`，原始字节却是 JPEG；原图请求返回 `image/png`，超出缩图能力的请求返回 `binary/octet-stream`。说明按扩展名推断 MIME 不足以保证正确，上传/服务端应检测实际格式。这个事实尚不足以证明它导致了大尺寸回退。

## 4. Discord、Slack 的公开实践，以及如何用于当前项目

下表使用官方 API 文档与工程文章。2016/2017 年文章描述的是当时方案，可借鉴原则，不能当作 2026 年客户端内部实现的完整说明；公开 API 也不能证明官方客户端每次请求的具体方式。

| 公开证据 | 对当前项目的启发 |
| --- | --- |
| Discord CDN 用资源 ID/哈希标识图片，头像等支持按 `size` 选择 16–4096 的 2 次幂规格，并能选择输出格式。[官方参考](https://docs.discord.com/developers/reference#image-formatting) | 用稳定的资源身份、内容版本和少量尺寸档位；26px 头像不复用原图下载逻辑。 |
| Discord 2017 年公开的 Media Proxy 使用缓存和相同请求合并来减少重复转换。[工程文章](https://discord.com/blog/how-discord-resizes-150-million-images-every-day-with-go-and-c) | 服务端统一生成/缓存变体，同一对象同一规格只处理一次；无需照搬其基础设施规模。 |
| Discord 2025 年说明，选择 WebP 作为主要转换目标考虑了兼容性、编解码速度和性能稳定性，而不仅是最小文件体积。[格式演进](https://discord.com/blog/modern-image-formats-at-discord-supporting-webp-and-avif) | 照片缩图优先验证 WebP；不要一开始就把所有图片转成编码成本更高的 AVIF。 |
| Slack 用户对象包含 `image_24/32/48/72/192` 等头像变体和 `avatar_hash`。[用户对象](https://docs.slack.dev/reference/objects/user-object/)；文件对象区分原始资源、多个 thumb 尺寸和原始宽高。[文件对象](https://docs.slack.dev/reference/objects/file-object/) | 用户资料和图片模型保留尺寸/版本/多规格资源，查看器不要只接收一个原图 URL。 |
| Slack 2016 年的 incremental boot 先让当前会话内容可见，完整模型在并行流程中补齐，并把“内容可见”和“完全就绪”分开测量。[启动流程](https://slack.engineering/getting-to-slack-faster-with-incremental-boot/) | 历史、成员首屏资料分开启动；已缓存信息先呈现，不能让一条非必要串行依赖阻塞另一块内容。 |
| Slack 2016 年按需拉历史、限制预取规模，并按未读/提及/常访问排序。[按需加载](https://slack.engineering/making-slack-faster-by-being-lazy/) | 保留当前 40 条分页方向；预取要有优先级、上限和取消机制，不能开图就预取几张原图。 |
| Slack 2017 年 Flannel 按需提供用户和频道资料，在消息前补发客户端缺少的相关用户数据，减少额外往返。[Flannel](https://slack.engineering/flannel-an-application-level-edge-cache-to-make-slack-scale-/) | 以用户 ID 维护共享资料；优先补当前可见发送者/成员，而不是依赖每个头像组件各自拉资料。 |
| Discord 2023 年的消息 data services 合并相同在途查询。[消息存储](https://discord.com/blog/how-discord-stores-trillions-of-messages) | 在当前客户端把成员、历史页、媒体变体请求按 key 合并即可，无需为此引入新的分布式消息数据库。 |

这些材料没有公开 Slack/Discord 当前桌面端全部解码缓存、原图升级阈值、分页常量。以下具体尺寸、并发和交互规则是针对本项目提出的设计。

## 5. 推荐落地方案

### A. 先统一图片资源描述，再接查看器

保留消息现有 URL 兼容旧数据，在 renderer 的资源解析层扩展一个 `MediaAsset`，暂不要求历史消息迁移：

```ts
type MediaAsset = {
  id: string;               // 会话 + clientMsgID + 附件位置，或服务端对象 ID
  version?: string;         // 内容哈希/头像版本
  width?: number;
  height?: number;
  original: { url: string; bytes?: number; mime?: string };
  preview?: { url: string; width: number; height: number };
  variants: Array<{ url: string; width: number; height: number; mime?: string }>;
};
```

原生图片保留 OpenIM `snapshotPicture/bigPicture/sourcePicture`，不要翻译时只挑一张后丢弃其余；自有附件根据已验证的服务能力生成变体描述。带签名的 URL 不随意加参数。`asset.id` 不用可变化的下载 URL 代替。

候选规格：头像 32/64/96/128；消息图片先复用 160/320/640/960。查看器较高规格 1280/1920 等要等服务端验证支持后开放；当前不能假定可用。按 CSS 槽位 × DPR 选择足够的一档，尊重原图大小与字节预算。

### B. 图片展示采用分阶段升级

```text
点击缩图
  → 立即显示已加载缩图/本机预览，几何尺寸固定
  → 当前图请求视口所需且服务已支持的显示图
  → 解码就绪后约 150–200ms 淡入清晰图
  → 用户继续放大或选择“原始尺寸”时，再请求原图
```

- 淡入期间低清图始终可见；不要变空白后显示纯文字等待。
- 原图下载失败仍保留显示图，提供原图重试，缩放和平移不被网络阻塞。
- `decode()` 完成后再切可见图层；切换源不重挂整个查看器，也不重置倍率与平移位置。
- 保留原始宽高作为坐标基础；显示图到原图的升级维持当前观看位置。需要验证 DPR 下“原始尺寸”的产品定义，不将相对 fit 的 `scale=1` 标成 100%。
- 当前图优先；当前图可用后，相邻一张可低优先级预取显示图；初期不预取相邻原图。换图/关闭时取消不再需要的任务，正在被其他组件使用的共享请求不能误取消。
- 上传继续保持本机预览。`上传中 → 服务已接收 → 消息发送成功` 分开表示；SDK 无字节进度时使用不定进度动画，不伪造百分比。遵循 reduced-motion。

### C. 查看器：先修复当前集成，完整桌面方案优先验证 YARL + Zoom

| 方案 | 适配程度与代价 | 建议 |
| --- | --- | --- |
| 继续 react-photo-view 1.2.7 | 控件层级、按钮、旋转、关闭生命周期可以小改；完整触控板映射、长图缩小和按缩放换清晰度不是简单加工具栏即可覆盖 | 用于当前版本快速修复；不建议长期维护大量依赖内部补丁 |
| Yet Another React Lightbox + Zoom | React 受控数据、响应式图、可配置预取；Zoom 文档明确区分触控板捏合/滚动平移，支持键盘缩放/平移 | **下一版完整查看器的首选验证方向**；接入共享 MediaAsset，默认预取设为 0 或很小；原位开合和旋转需求需单独验证/补充 |
| PhotoSwipe | 明确支持 fit/原始尺寸缩放、响应式资源、缩图开合；可用数据源驱动虚拟列表 | 若把缩略图原位开合列为最重要体验，作为备选；需要 React 生命周期适配 |

能力来源：[YARL 文档](https://yet-another-react-lightbox.com/documentation)、[Zoom 输入与控制 API](https://yet-another-react-lightbox.com/plugins/zoom)、[PhotoSwipe 响应式图片](https://photoswipe.com/getting-started/)、[PhotoSwipe 缩放层级](https://photoswipe.com/adjusting-zoom-level/)。这些是官方支持说明，不替代 Electron 33 中的集成测试。

不要沿用 `design/plan.md` 中直接比较整个 npm 包文件总量与单个压缩文件的选型方式。应对同一 demo、同一构建参数测量实际引入的 minified/gzip JS+CSS、开图主线程耗时、图片字节量和交互完成度。当前一张图片的 MB 级下载收益远大于只比较几 KB 的组件差异。

统一桌面交互验收：明确的放大、缩小、适应窗口、原始尺寸、倍率显示、上一张/下一张、关闭；双击在适应窗口与可读细节倍率间切换；触控板捏合缩放，放大后双指滚动平移；`+/-/0` 操作；长图可看全也可放大读字；缩放后仍能通过可见控件退出。旋转若继续保留组件承诺，也要有真实入口。

### D. 头像：数据并行、共享资料、按尺寸下载、保留占位

打开会话时立即并行启动历史第一页和成员第一页，各自独立成功/失败；先显示已有缓存。`markRead` 不参与这些视图的完成条件。已有 roster/消息发送者信息可以先补头像显示，但 roster 不能当作已确认的群成员列表。

资料层统一为 `usersById`，成员关系保存 userID 与群昵称、角色等覆盖字段。各区域从同一用户版本读取头像。按群保存 `status/data/fetchedAt/nextOffset/inFlight`，复用并发请求；同步完成事件触发缺失数据补拉，替代固定 1500ms 等待。

Avatar 始终保留字形或 agent 标记作为底层；图片就绪后轻微淡入，失败保留底层。首屏显示区域立即请求小图，视口外成员延迟请求；隐藏右栏暂停非必要图片请求。大群按页获取并按视口渲染，成员总数与当前已加载人数分开表示。

启动时只优先补自己、当前可见发送者、首屏成员的资料；其它用户在空闲时按需批量补齐。监听用户/成员信息变化，支持头像更新及清空；切换账号清理账号作用域内的资料状态。

### E. 缓存与请求调度

先利用 Electron 默认 HTTP 缓存，测清命中后再决定是否新增应用磁盘缓存。当前 SDK 已有按账号持久化的本地消息数据库，应继续通过 SDK 管理消息，不额外建立一套竞争的数据源。

媒体缓存 key 使用 `账号范围 + assetId + version + 尺寸 + format`；同一 key 的在途请求复用。大小近似的槽位归到固定档位，避免 URL 参数细碎变化降低命中。

服务端明确两层缓存：对象入口的 302/资源描述有效期，以及最终文件的缓存期。签名资源缓存期不得越过授权有效期；内容哈希确定、不可变的资源可使用长缓存，头像变更用新版本。服务应返回真实 MIME，确定变体支持范围，避免用 HTTP 200 的原图悄悄代替超规格缩图。

初始调度可以限制为 4 个主动媒体下载槽：保证当前查看图片可调高优先级；其余由首屏头像与消息缩图共享。相邻显示图只使用空闲配额。具体并发以限速测试调整，SDK 历史/成员请求独立调度，不要排在大图下载队列后。

若浏览器缓存仍无法满足跨会话/重启命中或离线要求，再增加主进程媒体缓存：按字节设置上限与 LRU，区分编码文件缓存和解码图像内存，登出清理相应账户的私有资源索引。不持久化大量原图为默认策略。

### F. 历史消息：修游标与隔离状态，再减少计算

1. 按会话记录 `olderCursor/status/hasMore/inFlight`，游标取 SDK 原始结果在当前方向的边界 ID，不用过滤后的最老展示消息。以 SDK `isEnd` 决定边界。
2. 原始页有进展但过滤后为空，继续取下一原始页直到有可显示内容或到达边界；每轮限制扫描页数/耗时，让出事件循环。原始页为空但 `isEnd=false` 或游标不变时进入可重试状态，避免死循环，也不永久宣告结束。
3. 原始回应仍按现有逻辑合并，保留 `clientMsgID` 去重。检查返回对象内的业务错误字段，不把部分失败误当正常结束；字段语义以安装的 OpenIM 版本为准。[OpenIM 历史接口](https://docs.openim.io/zh-hans/sdks/api/message/getadvancedhistorymessagelist)
4. A 会话历史请求不阻塞 B；快速切换时回包写回所属会话缓存，不改变当前滚动位置。
5. 保留 40 条初始分页，接近顶部再预取一页。以首个可见消息 ID + 像素偏移恢复阅读位置，合并历史时保留库的尺寸补偿。
6. 再做会话级订阅版本、增量分组或有界内存窗口。若裁掉已加载消息，必须同时支持向较新方向补页，保存锚点并保留待发送/引用状态，不能只截断数组造成阅读缺口。

## 6. 实施顺序与验收

| 顺序 | 变更与主要文件 | 完成标准 |
| --- | --- | --- |
| 1 | `Lightbox.tsx/.module.css`；`Avatar.tsx`；`session.open/loadMembers` | 放大后关闭/操作条始终可见；小头像走 64px 等合理规格；历史与成员独立开始，失败不互相阻塞 |
| 2 | 资源解析层、`translate.ts`、`Stream.tsx`、查看器；服务端媒体接口 | 点击立即复用缩图；当前图渐进清晰；没有无意相邻原图下载；变体返回尺寸/MIME/体积符合声明 |
| 3 | `session.ts`、`timeline.ts`、`Inspector.tsx` | 过滤空页不截断历史；会话之间分页互不阻塞；成员超过 200 可继续加载；隐藏区不过量请求 |
| 4 | HTTP 缓存配置、媒体调度与性能记录 | 重复进入、重启、快速翻图、头像更新都能解释缓存命中/失效；基于测量决定是否需要应用磁盘缓存 |

建议先建立以下性能目标，作为验收预算，不是对当前结果的承诺：

- 缓存缩图存在时，点击后 100ms 内可见图像；不把原图下载完成设为开图前提。
- 同样三张 26px 头像总下载量以本次 22KB 为基线，避免回到 MB 级；新照片显示图通过格式优化进一步降低 960px 当前约 905KB 的体积。
- 1500ms 人工成员等待从正常打开路径消失；分别记录成员资料到达、头像下载与头像可见时间。
- 在 2Mbps、100ms RTT 的测试网络上，记录首屏消息可读时间、头像完整时间、查看器首个像素/显示图清晰/原图清晰时间，报告 P50/P95，不只报一个总加载值。
- 缩放连续操作无超过 50ms 的明显主线程长任务；历史 prepend 后首个可见消息锚点偏差目标不超过 2 CSS px。
- 冷缓存、热缓存、应用重启、签名过期、图片失败、长图、Retina/普通屏切换、100 张图片历史、超过 200 成员、过滤空页、A/B 快速切换均有对应验收案例。

当前证据已足以安排前 3 阶段。尚需补齐的是 Electron 内资源命中/解码 trace、真实触控板验收，以及服务端缩图规格限制的配置原因；不能把这几项未测内容写成已经验证。

---

## 7. 实施记录（2026-09-13，第一阶段）

复核了本报告的每一条可核对断言，全部成立，没有发现与源码不符的地方。报告留作待确认的
「服务端缩图上限」一项已在服务器上逐档实测，结论补在下面。本节只记已经改完并验过的部分。

### 服务端缩图能力：上限就是 1024

用一个真实对象逐档请求（`u_zz_m7hmiae/att_…_720.png`，原文件 1280×2275 JPEG，239,640 字节）：

| 请求宽度 | 返回 | content-type |
| --- | --- | --- |
| 64 / 160 / 640 / 960 / 1024 | 真缩图 PNG | image/png |
| 1088 / 1280 / 2048 | 原文件 | binary/octet-stream |

1024 出得来、1088 出不来，报告推测的 1024 得到确认。两点补充：

1. **PNG 缩图可能比原图还大**，不只是「偏大」。上面这个对象的 1024 档缩图 721,680 字节，
   是原文件的三倍。所以「照片转有损格式」不是优化项，而是尺寸策略成立的前提。
2. `sized()` 原来允许到 2048。归到 160 的整数倍后，960 之上就是 1120，已经越界。
   现在按 `MAX_THUMB = 1024` 封顶，`sized()` 实际最高一档是 960。

### 已改并实测

| 条目 | 改动 | 验证 |
| --- | --- | --- |
| F1 控件被图盖住 | 控件层挪进 portal 内并抬到 z-index 30（图片层是 10）；`.portal` 走 PhotoSlider 的 className，不再用匹配不到的后代选择器 | 放大到 ×4.0，图 2560×1600 铺满 1119×778 的视口，关闭按钮和操作条 `elementFromPoint` 仍命中 |
| F2 缩放与翻页入口 | 操作条补上：上一张/下一张、缩小/倍率/放大、适应窗口、旋转、原图、另存为；`+ - 0` 快捷键接上库的 `onScale/onRotate` | 按 `0` 回到 ×1.0，按 `+` 到 ×1.3 |
| F2 关闭生命周期 | `visible` 受控 + `afterClose` 再卸载，不再直接 `setShot(null)` | 点关闭后 90ms portal 仍在且带 `willClose`，动画播完才卸 |
| F2 模态语义 | 库 portal 自带 `role="dialog"`，挂载后补 `aria-modal` 和名字；外壳不再套第二个 dialog，焦点循环改在 portal 内找可聚焦元素 | portal 上 role/aria-modal/aria-label 齐全 |
| F3 开图等原图 | 三段上图：列表已加载的缩图先顶上 → 按视口取显示图（≤1024）→ 原图只在点「原图」或另存时下。原图本来就不大（≤512KB）或比请求尺寸还小时直接用原图 | 12 张在屏图片全部带档位，0 个裸原图请求 |
| F4 头像下原图 | `avatarSized()` 走 32/64/128/256 档，按槽位×DPR 选 | 右栏 26px 的头像请求 `width=64`；该头像原文件 102,771 字节 → 9,132 字节，省 91% |
| F4 头像占位 | 字形和 agent 标记始终铺在底下，图片解码后淡入，失败保留字形 | — |
| F4 串行等待 | `open()` 不再 `await` 完第一页历史才拉成员，两边并行；`loadMembers` 去掉固定 1500ms，补数据交给 `OnSyncServerFinish` | — |
| F5 历史提前截断 | 边界只看 SDK 的 `isEnd`，游标取原始页最老那条的 clientMsgID；整页被过滤光时接着翻下一页，轮数封顶。判定逻辑抽成 `im/paging.ts`，7 个用例 | `npm test` 107 项通过 |
| F5 分页互相阻塞 | `loadingOlder` 从全局改到每条时间线上 | — |
| F5 成员 200 上限 | `im.members()` 支持 offset，按 200 一页翻到 2000；同群并发请求合并 | — |
| F5 空成员表毒化缓存 | 不再把同步期间的空表当结果存下来；`open()` 的判断从「有没有这个键」改成「有没有人」 | — |

窗口初始尺寸另改成按工作区比例（74%×82%，上限 1440×900）并记住用户调过的大小，
实测首次打开 1119×778。

### 已知未解决

- **换显示图时平移位置会回中。** 库的 `handlePhotoLoad` 在图片加载完调
  `getSuitableImageSize`，返回值里带 `x: 0, y: 0`，倍率保留但平移被重置。开图那一瞬间本来就
  在中心，所以正常路径看不出来；但放大平移之后再点「原图」会跳回中心。这条要靠换库解决。
- **触控板双指滚动仍然是缩放而不是平移。** `PhotoBox.handleWheel` 里 `scale - deltaY/200`
  不区分 ctrlKey，也不看 deltaX，改不动。
- **长图缩不到整张可见。** `minScale = 1` 是库的常量，`longModeRatio = 3` 的长图初始按宽度适应。

以上三条都在 react-photo-view 内部，是报告建议下一版验证 YARL + Zoom 的实际理由。
第二阶段（统一 MediaAsset、服务端有损格式、相邻预取限流）和缓存调度尚未开始。

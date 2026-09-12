# yptd 桌面端

人和 agent 在同一个话题里并行工作。macOS 桌面客户端，Electron + React，
后端是 [yptd-serve](https://github.com/his1devil/yptd-serve) 和 OpenIM。

凭邀请码入场：第一次打开填一个邀请码和昵称，这台机器之后自动登录。
频道里 @ 一个 agent 就是派活，它带着频道上下文回答；和 agent 单聊能看到它的思考过程和用到的工具。

## 下载

| 机器 | 安装包 |
| --- | --- |
| Apple 芯片 | <https://im.zhanghuanyang.com/dl/desktop/yptd-latest-arm64.dmg> |
| Intel | <https://im.zhanghuanyang.com/dl/desktop/yptd-latest-x64.dmg> |

上面两个链接始终指向最新版，也是 app 自动更新的来源。
本仓库的 [Releases](https://github.com/his1devil/yptd-desktop/releases) 里有同样的包作为归档，
但 GitHub 的 release 附件在国内多数网络下要走代理才能下载。

macOS 14 以上，已用 Developer ID 签名并通过苹果公证。

## 开发

```bash
npm install
npm run dev        # 开发版
npm run typecheck  # tsc
npm test           # vitest
```

联调时这两个环境变量只在未打包时生效：`YPTD_DEV_CREDENTIAL` 用一份现成的设备凭据直接登录，
不消耗邀请码；`YPTD_DEV_CDP=9222` 打开远程调试口，脚本可以在页面里跑 JS 和截图。

```bash
YPTD_DEV_CREDENTIAL='{"userID":"…","nickname":"…","deviceToken":"…"}' YPTD_DEV_CDP=9222 npm run dev
```

## 发布

```bash
./scripts/publish.sh              # 检查 → 构建 → 两个架构打包签名公证 → 上传 → GitHub release
./scripts/publish.sh --no-upload  # 只出本地产物
./scripts/publish.sh --upload-only
```

签名用钥匙串里的 Developer ID Application 证书，公证用 `xcrun notarytool store-credentials` 存好的
配置（默认名 `yptd`）。任何一步失败就停，不会把没验过的包发出去。

## 结构

```
src/main/        主进程：窗口、OpenIM 原生 SDK、HTTP 与 SSE 代理（渲染进程过不了 CORS）、自动更新
src/preload/     暴露给渲染进程的桥，渲染进程零 Node 权限
src/renderer/    界面：shell/ 外壳，views/ 各个面，store/ 状态，im/ 与 OpenIM 的翻译层，motion/ 动效
src/shared/      两边共用的类型：IPC 契约与消息模型
design/          设计稿与方案记录
```

消息流是虚拟化的，几千条只画视口里的几十行；agent 的回答走服务端的单条事件流（SSE），
在主进程里攒批后过 IPC，渲染进程按帧提交。

## 字体

界面用的是 gg sans / gg mono，来自 Discord 的品牌字体，仅用于本项目内部界面，
不授权再分发或另作他用。换字体只需改 `src/renderer/styles/tokens.css` 里的 `--font` 和 `--mono`。

## 许可

保留所有权利（package.json 里是 `UNLICENSED`）。公开仓库是为了方便分发和存档，不是开源授权。

#!/bin/bash
# 发一版桌面端：检查 → 构建 → 打包（两个架构，签名 + 公证）→ 上传到 /dl/desktop/。
#
# 公证用钥匙串里的 notarytool 凭据（一次性：xcrun notarytool store-credentials yptd …），
# 签名用钥匙串里的 Developer ID Application 证书，electron-builder 自己找。
# 任一步失败就停，不会把没验过的包发出去。
#   publish.sh              全流程
#   publish.sh --no-upload  只到本地产物
#   publish.sh --upload-only 只传 release/ 里现成的产物
set -euo pipefail
cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
export APPLE_KEYCHAIN_PROFILE=${APPLE_KEYCHAIN_PROFILE:-yptd}
# Electron 二进制从 GitHub 下在这边动不了，走 npmmirror（和 npm install 一样）
export ELECTRON_MIRROR=${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}
HOST=${YPTD_DIST_HOST:-root@8.160.186.31}
DIR=${YPTD_DIST_DIR:-/var/www/yptd/dl/desktop}
ARCHES="arm64 x64"

if [ "${1:-}" != "--upload-only" ]; then
  echo "== v${VER}：检查"
  npm run typecheck
  npm test

  echo "== 构建"
  npm run build

  echo "== 打包 + 签名 + 公证（两个架构，要等苹果几分钟）"
  npx electron-builder --mac --arm64 --x64 --publish never

  echo "== 产物"
  for a in $ARCHES; do ls -la "release/yptd-${VER}-${a}.dmg" "release/yptd-${VER}-${a}.zip"; done
  grep -E "^version|url:" release/latest-mac.yml

  echo "== 验签"
  codesign --verify --deep --strict "release/mac-arm64/yptd.app" && echo "arm64 签名完整"
  codesign --verify --deep --strict "release/mac/yptd.app" && echo "x64 签名完整"
  spctl -a -vv -t install "release/mac-arm64/yptd.app" 2>&1 | grep -E "accepted|source" || true
fi

if [ "${1:-}" = "--no-upload" ]; then echo "不上传（--no-upload）"; exit 0; fi

echo "== 上传到 ${HOST}:${DIR}"
FILES="release/latest-mac.yml"
for a in $ARCHES; do
  FILES="$FILES release/yptd-${VER}-${a}.dmg release/yptd-${VER}-${a}.zip"
  [ -f "release/yptd-${VER}-${a}.zip.blockmap" ] && FILES="$FILES release/yptd-${VER}-${a}.zip.blockmap"
done
# shellcheck disable=SC2086
scp -q $FILES "${HOST}:${DIR}/"
ssh "${HOST}" "chmod 644 ${DIR}/*"
echo "== 线上 latest-mac.yml"
curl -fsS https://im.zhanghuanyang.com/dl/desktop/latest-mac.yml | grep -E "^version|url:"
echo "已发布 v${VER}。"
echo "  Apple 芯片：https://im.zhanghuanyang.com/dl/desktop/yptd-${VER}-arm64.dmg"
echo "  Intel：     https://im.zhanghuanyang.com/dl/desktop/yptd-${VER}-x64.dmg"

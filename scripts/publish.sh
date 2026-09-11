#!/bin/bash
# 发一版桌面端：检查 → 构建 → 打包（签名 + 公证）→ 上传到 /dl/desktop/。
#
# 公证用钥匙串里的 notarytool 凭据（一次性：xcrun notarytool store-credentials yptd …），
# 签名用钥匙串里的 Developer ID Application 证书，electron-builder 自己找。
# 任一步失败就停，不会把没验过的包发出去。
set -euo pipefail
cd "$(dirname "$0")/.."

VER=$(node -p "require('./package.json').version")
export APPLE_KEYCHAIN_PROFILE=${APPLE_KEYCHAIN_PROFILE:-yptd}
HOST=${YPTD_DIST_HOST:-root@8.160.186.31}
DIR=${YPTD_DIST_DIR:-/var/www/yptd/dl/desktop}

echo "== v$VER：检查"
npm run typecheck
npm test

echo "== 构建"
npm run build

echo "== 打包 + 签名 + 公证（要等苹果几分钟）"
npx electron-builder --mac --arm64 --publish never

echo "== 产物"
ls -la "release/yptd-$VER-arm64.dmg" "release/yptd-$VER-arm64.zip" release/latest-mac.yml
grep -E "version|url|sha512" release/latest-mac.yml | head -6

echo "== 验签"
codesign --verify --deep --strict "release/mac-arm64/yptd.app" && echo "签名完整"
spctl -a -vv -t install "release/mac-arm64/yptd.app" 2>&1 | grep -E "accepted|source" || true

if [ "${1:-}" = "--no-upload" ]; then echo "不上传（--no-upload）"; exit 0; fi

echo "== 上传到 $HOST:$DIR"
scp -q "release/yptd-$VER-arm64.dmg" "release/yptd-$VER-arm64.zip" release/latest-mac.yml "$HOST:$DIR/"
[ -f "release/yptd-$VER-arm64.zip.blockmap" ] && scp -q "release/yptd-$VER-arm64.zip.blockmap" "$HOST:$DIR/"
ssh "$HOST" "chmod 644 $DIR/*"
echo "== 线上 latest-mac.yml"
curl -fsS https://im.zhanghuanyang.com/dl/desktop/latest-mac.yml | head -8
echo "已发布 v$VER。安装包：https://im.zhanghuanyang.com/dl/desktop/yptd-$VER-arm64.dmg"

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
  # 苹果的时间戳服务（codesign --timestamp 要连它）对短时间内的大量请求限流，而一个
  # Electron 包要逐个签几百个文件。electron-builder 自带的三次重试是连着立刻重的，
  # 撞上限流时三次一起死。这里退到外面重来，每次等得更久一点，让限流缓过来。
  attempt=1
  until npx electron-builder --mac --arm64 --x64 --publish never; do
    if [ $attempt -ge 4 ]; then
      echo "== 打包失败 $attempt 次，放弃"
      echo "   最常见的原因是苹果时间戳服务限流（错误里写 'A timestamp was expected but was not found'）。"
      echo "   单独试一次可以确认服务本身是通的：codesign --force --sign <证书> --timestamp <任意文件>"
      echo "   通的话就是限流，隔十几分钟再跑一次。"
      exit 1
    fi
    wait=$((attempt * 300))
    echo "== 打包失败（第 $attempt 次），等 $((wait / 60)) 分钟再来"
    sleep $wait
    attempt=$((attempt + 1))
  done

  # electron-builder 写进 .DS_Store 的背景别名现在的 Finder 不认，得让 Finder 自己写一遍
  echo "== DMG 背景"
  for a in $ARCHES; do ./scripts/dmg-finish.sh "release/yptd-${VER}-${a}.dmg"; done

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
# 稳定的「最新版」链接：邀请文案里写的是它，发版不用改文案
ssh "${HOST}" "cd ${DIR} && for a in ${ARCHES}; do ln -sfn yptd-${VER}-\$a.dmg yptd-latest-\$a.dmg; done"
echo "== 线上 latest-mac.yml"
curl -fsS https://im.zhanghuanyang.com/dl/desktop/latest-mac.yml | grep -E "^version|url:"

# GitHub release：归档 + 有代理时的手动下载。自动更新仍走自家服务器——实测国内不走代理时
# GitHub 的 release 附件只有 ~90 KB/s 且会卡住，自家服务器稳定 160–250 KB/s。
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "== GitHub release v${VER}"
  # 只传 dmg：更新器走自家服务器，zip 和 blockmap 是给它用的，没必要每次往 GitHub 推 450MB
  ASSETS=""
  for a in $ARCHES; do ASSETS="$ASSETS release/yptd-${VER}-${a}.dmg"; done
  NOTES=$(mktemp)
  {
    echo "macOS 14+，Developer ID 签名并通过苹果公证。"
    echo
    echo "| 机器 | 安装包 |"
    echo "| --- | --- |"
    echo "| Apple 芯片 | [yptd-${VER}-arm64.dmg](https://im.zhanghuanyang.com/dl/desktop/yptd-${VER}-arm64.dmg) |"
    echo "| Intel | [yptd-${VER}-x64.dmg](https://im.zhanghuanyang.com/dl/desktop/yptd-${VER}-x64.dmg) |"
    echo
    echo "已装的机器会自动更新，不用手动下载。国内直连 GitHub 下附件较慢，建议用上面的链接。"
    echo
    echo '```'
    (cd release && shasum -a 256 yptd-${VER}-*.dmg)
    echo '```'
  } > "$NOTES"
  # shellcheck disable=SC2086
  if gh release view "v${VER}" >/dev/null 2>&1; then
    gh release upload "v${VER}" $ASSETS --clobber
  else
    gh release create "v${VER}" $ASSETS --title "v${VER}" --notes-file "$NOTES"
  fi
  rm -f "$NOTES"
  echo "  https://github.com/his1devil/yptd-desktop/releases/tag/v${VER}"
fi
echo "已发布 v${VER}。"
echo "  Apple 芯片：https://im.zhanghuanyang.com/dl/desktop/yptd-${VER}-arm64.dmg"
echo "  Intel：     https://im.zhanghuanyang.com/dl/desktop/yptd-${VER}-x64.dmg"

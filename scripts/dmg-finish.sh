#!/bin/bash
# 让 DMG 的背景图真正显示出来。
#
# electron-builder 走 dmgbuild，用 Python 直接往 .DS_Store 里写 backgroundImageAlias 和
# pBBk 书签。这两条记录在现在的 macOS 上 Finder 解析不了——窗口大小、图标位置、图标尺寸
# 都生效，唯独背景是白的。只有 Finder 自己写进去的那份别名它才认。
#
# 所以这里把打好的 dmg 转成可写镜像挂上，用 AppleScript 让 Finder 设一遍背景，
# 再压回只读。dmg 本身没签名也没 staple（签名和公证都在里面的 .app 上），
# 所以事后改它是安全的。
#
#   dmg-finish.sh release/yptd-0.3.5-arm64.dmg
set -euo pipefail
cd "$(dirname "$0")/.."

DMG=${1:?用法: dmg-finish.sh <dmg 路径>}
[ -f "$DMG" ] || { echo "找不到 $DMG" >&2; exit 1; }

WORK=$(mktemp -d)
RW="$WORK/rw.dmg"
MNT=""
cleanup() {
  [ -n "$MNT" ] && hdiutil detach "$MNT" -quiet 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

hdiutil convert "$DMG" -format UDRW -o "$RW" -quiet
MNT=$(hdiutil attach "$RW" -nobrowse -noverify -readwrite -plist \
  | awk -F'[<>]' '/<string>\/Volumes\//{print $3; exit}')
[ -n "$MNT" ] || { echo "挂不上 $RW" >&2; exit 1; }
VOL=$(basename "$MNT")

BG=$(ls "$MNT/.background/" 2>/dev/null | head -1)
[ -n "$BG" ] || { echo "卷里没有 .background/，检查 electron-builder.yml 的 dmg.background" >&2; exit 1; }

# electron-builder 一定会留一份 .DS_Store；没有也不算错，Finder 会新建
stamp() { md5 -q "$MNT/.DS_Store" 2>/dev/null || echo none; }
BEFORE=$(stamp)

# Finder 需要窗口真的开着才会写 .DS_Store。位置随便放，用户打开时 Finder 会重新摆。
osascript >/dev/null <<OSA
tell application "Finder"
  tell disk "$VOL"
    open
    delay 1
    set w to container window
    set current view of w to icon view
    set toolbar visible of w to false
    set statusbar visible of w to false
    -- 底部那条「📄 yptd 0.3.6-arm64」是路径栏，跟着用户的 Finder 偏好走，
    -- 会压掉背景图下沿。窗口设置存在卷自己的 .DS_Store 里，不影响用户别的窗口。
    set pathbar visible of w to false
    set b to bounds of w
    set bounds of w to {item 1 of b, item 2 of b, (item 1 of b) + 600, (item 2 of b) + 380}
    set o to icon view options of w
    set arrangement of o to not arranged
    set background picture of o to file ".background:$BG"
    delay 1
    update without registering applications
    delay 2
    close
  end tell
end tell
OSA

# Finder 是异步写 .DS_Store 的，等它落盘
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 1
  AFTER=$(stamp)
  [ "$AFTER" != "$BEFORE" ] && break
done
if [ "$AFTER" = "$BEFORE" ]; then
  echo "Finder 没有改写 .DS_Store——背景多半没设上。" >&2
  echo "如果是第一次在这台机器上跑，去「系统设置 → 隐私与安全性 → 自动化」把终端对 Finder 的权限打开。" >&2
  exit 1
fi

hdiutil detach "$MNT" -quiet
MNT=""
rm -f "$DMG"
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$DMG" -quiet
echo "  背景已生效：$(basename "$DMG")"

# 重写过 dmg，electron-builder 早先算的摘要就不对了
python3 scripts/refresh-manifest.py "$(dirname "$DMG")/latest-mac.yml" "$DMG"

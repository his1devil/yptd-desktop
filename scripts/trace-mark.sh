#!/bin/bash
# 从品牌图描摹出 src/renderer/src/components/Mark.tsx 里的矢量路径。
#
# 为什么要有这个脚本：Mark 一开始是照着 logo 手画的近似，帽檐又宽又平、脸画成了
# 正椭圆，和真 logo 不是一个东西。有源图就该从源图转。
#
# 需要 potrace（brew install potrace）和 Electron（拿它解 PNG，仓库里本来就有）。
#   ./scripts/trace-mark.sh [源图]
set -euo pipefail
cd "$(dirname "$0")/.."

SRC=${1:-../yptd-app/logo2.png}
[ -f "$SRC" ] || { echo "找不到源图 $SRC"; exit 1; }
command -v potrace >/dev/null || { echo "要先 brew install potrace"; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# 1) 裁出那个最大的图形。logo2.png 是张 1254px 的品牌规范图，左上角是 1024 版。
#    换了源图的话这几个数要跟着改——裁歪了会把邻居图标的边缘带进来，变成噪点路径。
sips -c 880 880 --cropOffset 40 100 "$SRC" --out "$WORK/crop.png" >/dev/null

# 2) PNG → 单色位图。用 Electron 的 nativeImage 解码，省得为两行代码装图像库。
cat > "$WORK/topbm.cjs" <<'JS'
const { app, nativeImage } = require('electron')
const fs = require('fs')
app.whenReady().then(() => {
  const [src, out] = process.argv.slice(2)
  const img = nativeImage.createFromPath(src)
  const N = 320
  const b = img.resize({ width: N, height: N, quality: 'best' }).toBitmap()
  const rowBytes = Math.ceil(N / 8)
  const bits = Buffer.alloc(rowBytes * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = (y * N + x) * 4
    // 图形是白的、底是深色；亮度过线就算前景
    if (0.114 * b[i] + 0.587 * b[i + 1] + 0.299 * b[i + 2] > 140) bits[y * rowBytes + (x >> 3)] |= 128 >> (x & 7)
  }
  fs.writeFileSync(out, Buffer.concat([Buffer.from(`P4\n${N} ${N}\n`), bits]))
  app.quit()
})
JS
npx electron "$WORK/topbm.cjs" "$WORK/crop.png" "$WORK/logo.pbm" >/dev/null 2>&1

# 3) 描摹
potrace "$WORK/logo.pbm" -s -o "$WORK/traced.svg" --turdsize 8 --alphamax 1.0 --opttolerance 0.35

# 4) 写成组件。turdsize 已经滤掉小噪点，但裁图边缘偶尔还会剩一条——
#    这里按路径长度再筛一次，太短的不是图形的一部分。
python3 - "$WORK/traced.svg" <<'PY'
import re, sys, pathlib
svg = pathlib.Path(sys.argv[1]).read_text()
paths = [d for d in re.findall(r'<path[^>]*?d="([^"]*)"[^>]*?/>', svg) if len(d) > 100]
body = '\n      '.join(f'<path d="{d}" />' for d in paths)
pathlib.Path('src/renderer/src/components/Mark.tsx').write_text(f'''/**
 * yptd 的标记：戴宽檐帽的一张脸。
 *
 * 路径是从品牌图自动描摹出来的（potrace），不是手画的近似。要重新生成：
 *   ./scripts/trace-mark.sh [源图]
 *
 * 原图的立体渐变和投影没有保留——单色才能跟着用它的人变色（agent 头像用各自的
 * 身份色），而且 20px 以下渐变本来也看不见。填充用 currentColor，谁用它谁定色。
 */
export function Mark({{ size = 22, className }}: {{ size?: number; className?: string }}) {{
  return (
    <svg width={{size}} height={{size}} viewBox="0 0 320 320" fill="none" className={{className}} aria-hidden="true">
      {{/* potrace 的坐标系 y 向上、放大十倍，这个 transform 转回 SVG 的 */}}
      <g transform="translate(0,320) scale(0.1,-0.1)" fill="currentColor" stroke="none">
      {body}
      </g>
    </svg>
  )
}}
''')
print(f"保留 {len(paths)} 条路径")
PY
echo "写好了 src/renderer/src/components/Mark.tsx"

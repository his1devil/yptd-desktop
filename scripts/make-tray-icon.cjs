/**
 * 从 app 图标生成菜单栏用的 template 图标，并把它们内联成 src/main/trayIcon.ts。
 *
 * macOS 的 template image 是「纯黑 + alpha」，系统按菜单栏亮暗自己反色，所以只需要
 * 一份。做法是把 build/icon.png 里白色的那部分（标记本身）抠出来当作剪影。
 *
 * 用 Electron 的 nativeImage 而不是 PIL/ImageMagick：它本来就在依赖里，能解 PNG、
 * 给原始 BGRA、还能高质量缩放，不用为了两张小图再装一套图像库。
 *
 *   npm run tray:icon
 */
const { app, nativeImage } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const SRC = path.join(root, 'build/icon.png')
/** 圆角方块的背景边距，按比例裁掉 */
const PAD = 0.14
/** 亮度低于这个值当背景，透明 */
const FLOOR = 110
/**
 * 画布高度。macOS 菜单栏是 22pt，惯例是 16pt 的图标——留白留在画布里，而不是把
 * 内容铺满。原来是 18px 且内容裁到外接框、四周零留白，结果图标比旁边的未读数字
 * "胖"一圈，看着就是没对齐。
 */
const BOX = [[16, 'trayTemplate.png'], [32, 'trayTemplate@2x.png']]
/**
 * 图形占画布高度的比例，剩下的是上下留白。1 就是铺满。
 *
 * 0.80 是照着真机截图量出来的：系统自带项（✳）在 2 倍图上是 25px 高，我们原来 28px
 * 比它还高一圈——图标越高，旁边那个矮矮的未读数字越显得"飘在上面"。
 */
const FILL = 0.80
/**
 * 垂直微调，画布高度的比例，负数往上。
 *
 * 同样是量出来的：系统所有菜单栏项的外接框中心都在 32.0（2 倍图），我们居中放是 32.5，
 * 低半像素。这个图形帽子在上、圆脸在下，实心的重量压在下半部，几何居中看着就偏低。
 */
const NUDGE = -0.03

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(SRC)
  const { width: W, height: H } = src.getSize()
  if (!W) throw new Error('读不到 ' + SRC)
  const buf = src.toBitmap() // BGRA
  const pad = Math.round(W * PAD)

  const alpha = Buffer.alloc(W * H)
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      let v = 0
      if (x >= pad && x < W - pad && y >= pad && y < H - pad) {
        const lum = 0.114 * buf[i] + 0.587 * buf[i + 1] + 0.299 * buf[i + 2]
        v = lum < FLOOR ? 0 : Math.min(255, Math.round((lum - FLOOR) * 255 / (255 - FLOOR - 25)))
      }
      alpha[y * W + x] = v
      if (v > 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    }
  }

  // 裁到内容的外接框：菜单栏那一条寸土寸金，四周不留白
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1
  const out = Buffer.alloc(bw * bh * 4)
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = (y * bw + x) * 4
      out[o] = out[o + 1] = out[o + 2] = 0
      out[o + 3] = alpha[(y + y0) * W + (x + x0)]
    }
  }
  const mark = nativeImage.createFromBitmap(out, { width: bw, height: bh })

  const b64 = {}
  for (const [box, name] of BOX) {
    // 图形按比例缩到 FILL，再垂直居中放进 box 高的画布里：上下各留一点白，
    // 图标的视觉重量才和旁边的数字持平。
    const glyphH = Math.round(box * FILL)
    const glyphW = Math.max(1, Math.round(bw * glyphH / bh))
    const scaled = mark.resize({ width: glyphW, height: glyphH, quality: 'best' })
    const src = scaled.toBitmap()
    const top = Math.round((box - glyphH) / 2 + NUDGE * box)
    const canvas = Buffer.alloc(glyphW * box * 4) // 全 0 = 全透明
    src.copy(canvas, top * glyphW * 4)
    const png = nativeImage.createFromBitmap(canvas, { width: glyphW, height: box }).toPNG()
    fs.writeFileSync(path.join(root, 'build', name), png)
    b64[box] = png.toString('base64')
    console.log(name, `${glyphW}x${box}（图形 ${glyphW}x${glyphH}，上留 ${top}、下留 ${box - glyphH - top}）`, png.length, 'bytes')
  }

  const wrap = (s) => s.replace(/(.{100})/g, "$1'\n  + '").replace(/^/, "  '").replace(/$/, "'")
  fs.writeFileSync(path.join(root, 'src/main/trayIcon.ts'), `/**
 * 菜单栏图标，直接内联。由 scripts/make-tray-icon.cjs 生成，别手改。
 *
 * 打包时 \`files\` 只收 out/ 和 package.json，build/ 是构建资源、不进 app 包；
 * 走 extraResources 就得在 dev 和打包后分叉路径，而那正是「开发时好好的、
 * 装完图标没了」这类 bug 的经典来源。两张图一共两千多字节，内联最省心。
 *
 * 是 macOS 的 template image：纯黑 + alpha，系统按菜单栏亮暗自己反色，
 * 所以这里不需要准备深色版本。
 *
 * 改了 build/icon.png 之后跑 \`npm run tray:icon\` 重新生成。
 */
export const TRAY_ICON_1X =
${wrap(b64[16])}

export const TRAY_ICON_2X =
${wrap(b64[32])}
`)
  console.log('写好了 src/main/trayIcon.ts')
  app.quit()
})

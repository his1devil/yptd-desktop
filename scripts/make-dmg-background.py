#!/usr/bin/env python3
"""生成 DMG 安装窗口的背景图：一条从应用图标弯到 Applications 的弧线箭头。

窗口里 Finder 会把两个图标画在上半部分，这张图只负责下面那条弧线——两个图标是眼睛，
弧线是嘴，整体是一张笑脸。

同时出 1x 和 2x 两张，再用 tiffutil 合成一个 HiDPI 的 tiff 给 electron-builder。
纯标准库实现：沿曲线按细步长盖圆点，边缘按到圆心的距离算覆盖度，取最大值，就是抗锯齿的圆头描边。
"""
import math, struct, zlib, sys, pathlib

W, H = 600, 380                      # 和 electron-builder.yml 里的 dmg.window 一致
BG = (255, 255, 255)
INK = (0x7D, 0x87, 0xF5)             # --accent 调浅一档：安装窗口是提示，不该比图标还抢眼
# 三次贝塞尔：起点在图标下方，终点指向 Applications。
# 最低点约 y=306，离窗口下沿留 70 多个点——Finder 会按标题栏高度裁掉底部一条，留够才不显得贴边。
CURVE = ((175, 262), (240, 312), (360, 314), (425, 254))
STROKE = 3.6                         # 1x 下的线宽
HEAD_LEN, HEAD_DEG = 17.0, 26.0      # 箭头两撇的长度与张角


def bezier(t, p):
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = p
    u = 1 - t
    a, b, c, d = u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t
    return (a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3)


def stamp(cov, w, h, cx, cy, r):
    """在 (cx,cy) 盖一个半径 r 的圆点，边缘一像素内按距离给覆盖度"""
    x0, x1 = max(0, int(cx - r - 1)), min(w - 1, int(cx + r + 1))
    y0, y1 = max(0, int(cy - r - 1)), min(h - 1, int(cy + r + 1))
    for y in range(y0, y1 + 1):
        dy = y + 0.5 - cy
        row = y * w
        for x in range(x0, x1 + 1):
            dx = x + 0.5 - cx
            a = r + 0.5 - math.hypot(dx, dy)
            if a <= 0:
                continue
            if a > 1:
                a = 1.0
            if a > cov[row + x]:
                cov[row + x] = a


def segment(cov, w, h, p0, p1, r):
    n = max(2, int(math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 3))
    for i in range(n + 1):
        t = i / n
        stamp(cov, w, h, p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, r)


def render(scale):
    w, h = W * scale, H * scale
    cov = [0.0] * (w * h)
    r = STROKE * scale / 2
    pts = [(x * scale, y * scale) for x, y in CURVE]
    steps = 900 * scale
    prev = bezier(0.0, pts)
    for i in range(1, steps + 1):
        cur = bezier(i / steps, pts)
        stamp(cov, w, h, cur[0], cur[1], r)
        prev = cur
    # 箭头：从终点沿切线反方向劈两撇
    tip = bezier(1.0, pts)
    tx, ty = tip[0] - pts[2][0], tip[1] - pts[2][1]
    ang = math.atan2(ty, tx)
    for side in (+1, -1):
        a = ang + math.pi + side * math.radians(HEAD_DEG)
        end = (tip[0] + math.cos(a) * HEAD_LEN * scale, tip[1] + math.sin(a) * HEAD_LEN * scale)
        segment(cov, w, h, tip, end, r)

    raw = bytearray()
    for y in range(h):
        raw.append(0)
        row = y * w
        for x in range(w):
            a = cov[row + x]
            if a <= 0:
                raw += bytes(BG)
            else:
                raw += bytes(round(BG[i] + (INK[i] - BG[i]) * a) for i in range(3))
    return w, h, bytes(raw)


def write_png(path, w, h, raw):
    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    pathlib.Path(path).write_bytes(png)


if __name__ == '__main__':
    out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'build')
    for scale, name in ((1, 'dmg-background.png'), (2, 'dmg-background@2x.png')):
        w, h, raw = render(scale)
        write_png(out / name, w, h, raw)
        print(f'  {name}  {w}x{h}')

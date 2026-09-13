#!/usr/bin/env python3
"""重算 latest-mac.yml 里某个安装包的 sha512 和 size。

dmg-finish.sh 打完包之后还会重写 dmg（为了让 Finder 认背景），
electron-builder 早先算好的那份摘要就对不上了，更新器会当成损坏的包。

  refresh-manifest.py release/latest-mac.yml release/yptd-0.3.6-arm64.dmg
"""
import base64
import hashlib
import pathlib
import re
import sys


def main() -> int:
    yml, pkg = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    if not yml.exists():
        return 0
    name = pkg.name
    digest = base64.b64encode(hashlib.sha512(pkg.read_bytes()).digest()).decode()
    size = pkg.stat().st_size

    lines, out, i = yml.read_text().splitlines(), [], 0
    hit = False
    while i < len(lines):
        if not re.match(r"^\s*-\s+url:\s*%s\s*$" % re.escape(name), lines[i]):
            out.append(lines[i])
            i += 1
            continue
        hit = True
        out.append(lines[i])
        i += 1
        # 这条记录下面缩进的几行：sha512 和 size 换掉，别的原样留着
        while i < len(lines) and re.match(r"^\s+\w+:", lines[i]) and not lines[i].lstrip().startswith("-"):
            pad = lines[i][: len(lines[i]) - len(lines[i].lstrip())]
            key = lines[i].strip().split(":")[0]
            if key == "sha512":
                out.append("%ssha512: %s" % (pad, digest))
            elif key == "size":
                out.append("%ssize: %d" % (pad, size))
            else:
                out.append(lines[i])
            i += 1

    text = "\n".join(out) + "\n"
    # 顶层的 path / sha512 顶格写，和上面缩进的记录区分得开；指向同一个包时也要跟着改
    if re.search(r"^path:\s*%s\s*$" % re.escape(name), text, re.M):
        text, n = re.subn(r"^sha512:\s*\S+\s*$", "sha512: " + digest, text, count=1, flags=re.M)
        hit = hit or bool(n)
    if not hit:
        print("  %s 里没有 %s，没动" % (yml.name, name))
        return 0
    yml.write_text(text)
    print("  %s：%s 的摘要已更新" % (yml.name, name))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

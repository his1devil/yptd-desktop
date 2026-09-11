// electron-builder 的 afterPack 钩子：包里两个 Mac 架构的原生库都带着，
// 这里按目标架构把另一份删掉，省 ~25MB，也少签一批文件。
const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  const { Arch } = require('builder-util')
  const arch = Arch[context.arch] // 'arm64' | 'x64'
  const other = arch === 'arm64' ? 'x64' : 'arm64'
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const mods = join(app, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules')
  for (const dir of [
    join(mods, 'koffi', 'build', 'koffi', `darwin_${other}`),
    join(mods, '@openim', 'electron-client-sdk', 'assets', `mac_${other}`),
  ]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
  }
  console.log(`  • afterPack: ${arch} 包，删掉了 ${other} 的原生库`)
}

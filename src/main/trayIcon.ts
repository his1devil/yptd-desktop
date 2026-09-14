/**
 * 菜单栏图标，直接内联。由 scripts/make-tray-icon.cjs 生成，别手改。
 *
 * 打包时 `files` 只收 out/ 和 package.json，build/ 是构建资源、不进 app 包；
 * 走 extraResources 就得在 dev 和打包后分叉路径，而那正是「开发时好好的、
 * 装完图标没了」这类 bug 的经典来源。两张图一共两千多字节，内联最省心。
 *
 * 是 macOS 的 template image：纯黑 + alpha，系统按菜单栏亮暗自己反色，
 * 所以这里不需要准备深色版本。
 *
 * 改了 build/icon.png 之后跑 `npm run tray:icon` 重新生成。
 */
export const TRAY_ICON_1X =
  'iVBORw0KGgoAAAANSUhEUgAAABIAAAAQCAYAAAAbBi9cAAABb0lEQVQ4jc3Tu2uUQRQF8N+3u0mIxDdsoWACihpTCKIoCBZGAmkt'
  + 'bARRWwUbK8Ei/4NNCGnzgBSxDAhaCIJFMKCFsIJiY5qIT0STrM35dJqAjZALwwxz55x77mP4j1Zl348JvMR3fMUy7mPHv5Kcxmt0'
  + 's35hPWSLmMKu4r1mQdJEA8fxIopqa2T14hkOYgRLue9WOWwWoAs4gzdJqcJeHMZZDKCT8/mo1ApJH0YxhiH0o40efMF7vMI0vuEA'
  + '9mBngnVbuIUb+IkVrOEIPuVRD45hPGq6eIqHyeBPNhsB3cMVPMDRLZrRxk08KXB3a+dJzOJtol3O/XUMpoZVmnGxIL2DmWCWymiX'
  + '8AP7Al6PwtoOBTQU/3NMpsOdRgreSPX7UodNPMaHKGlmlpbxOf4RfMRVDJeKBkI2t+W4/rWJqBusL1rZq5BcwwLO4VFmaS0Kdie9'
  + 'UZzAbbyL2o0ySj3up1L81eKL1GsV8xnGErMN7TfGiVjKUMVaHQAAAABJRU5ErkJggg=='

export const TRAY_ICON_2X =
  'iVBORw0KGgoAAAANSUhEUgAAACMAAAAgCAYAAACYTcH3AAADmUlEQVRYhe3WSaiWVRgH8N8d1Mops7JcVA5hhhENVouIBkmKbNUI'
  + 'bbJFVCgUBIEFhSAGLYoIKjIo2hhEReUqKMrAlAYpqTShSa0osxveTO/9vjb/E8fXt+t1WPrA4bzDc57n/8yHY9ROPYfI34tOnk/A'
  + 'DViEizAdYzCIrViLV7E+/H0YPlrAe7OPwVJ8je4o1ls4ryHjqACZhw2VomEMZe9Uayjrm4p38dEAVEI5HzsjeG8LgE7+FTAd3I2Z'
  + 'eCLvNx0JoJ6sadgWgX9jXwDtq1bTQ8MBtxEL8Ch246TD9UqxYPUo86OsAnAQz+In7Mm/hyKzr83ykYB0cQXex/YI3Z5wDYZnIk5O'
  + 'NU3HKQ059+MNXINlOTdvNJ7oCeIa9ek4YzSHQ7NxG56vKm4v7sGDCeH0NmeUlxKOTvWvH7MCZCbmRMiJKe/hWLkz3tqa6tmM3yo5'
  + 'c3BXqmlqvl0Vb/c2dO6X2afiFrwYoZ1DzJVuAH6FV3Bnw6sL0xpubtH9H50fALtaEnEbPsVH+BK/JhlHC3QfPsdjmNHQux+YHtyL'
  + 'J+P6AbyDN/Edvo/iy7LGh2cn/oyifkxIbp2Nc6J0SovRXbyLZ6JDM1TdKPw4Sbe0yvYZmS+f4D6c1VaSLTQN12IF1uGfFo+tw3UN'
  + 'x/gwP3fgiwy41XgaP+KvDMIm9cWqvsZqo3OxHJ9VzbCslzC5ME7GC40Yb8AveX84fGOyj8W4UXinjRZkRLwWI4vOjTizZrwAT6WK'
  + 'BmLBnpR1GQvjE7JNtTUVlYS8HR9gbt7747UHsBI3Ygm2VCHc0BRSDq5IUm2pPCLAijVFUd24ipw14VmS9+LJR5L8a3AHXk51dtGt'
  + 'm11vQjCE4/O9VExPxbcn39ouSt3su6th2vw/BZemGGZnfOzA4v6KsYx+6bIwKZ4q33txXAuIQj1ROD4ebebW1MqzmzLrVqaI/uhv'
  + 'ESbJK0k1K+GSBlj6ww8Nb9S0No10XWUoXJ79Z7zeOHNANy4frq8sWFX9O5RL0YTsxeBF1V1nVQwfm8Qe8S4+Dt9WLX/ZCLw9ATmS'
  + 'wIUZnkORd2F1dkQq1i/MwSJgfapjfgZqM8Q1Tcy0vjU9ZbgybHlDz35W/R+gTkb/cy2ddRd+T7UNplf0JbknpWKmJgw1PZ6b3gFX'
  + 'h4NRQX5xbmoDh3Gd6Abw27jyIA44aMxqC+bialyS6XxawjEuXunEQwPpG5sT2vdy42vKO0bH6IjpX9Z4RbMCTie2AAAAAElFTkSu'
  + 'QmCC'

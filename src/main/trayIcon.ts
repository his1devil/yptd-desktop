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
  'iVBORw0KGgoAAAANSUhEUgAAABkAAAASCAYAAACuLnWgAAACMklEQVRIiZXVTWhVVxQF4C8vsQmoA0trQUyNOrBYlEJSJYJgoaDS'
  + 'OigKDkyGRRScleLMSTtRxEmgpTMFRVDRkonSIoiIJVAcqAgqiuIPaBVNpGr+npN15XhJYnvgsO87d5+19l5nnfuYeTSKuBUncRcv'
  + 'MYLLGMDK5LW8B29agrX4C81p5ige48D/JaoStwSkiVeZoxhLHMc59OE49v9Xoirhixmqr8/T+C3Pq+pEbTXwRuI4duE8ruEp/kUH'
  + '5qMLSxNb8AhD6MT2PDcwUQFXc7LW0WeJHSlmHC/wDMPJ/whfoj/krViIxSVQW9HyEnyDDejJpunGMG6m4rP4IRjrs392HDhZdfI5'
  + 'fsLGHOwdXI0Ei/AJ2tP6B5iLjxPLcQlHcCbWFskmFa45hc152RX/78CKyFKdXyvm5W5swy+4UjPCSawuKxhMlQ9jx8N4jd0zyFUf'
  + 'LTmbAVwvyPaW5urHxUg0Eb2rzWvi//YCtJH5Hb4t1tfGlXtwL0S/1yvqjoaHirWfk9xZEFd34Ab+Loj7cvt/xNHsG6s+HbMSnye+'
  + 'LoCqnHI0C8JyrbL1ctzHr+iu9BpPHEvsyaYGLuAY/inAKtf8GTu3Rube5AzixBTFvZVhKEDfT5U0w+gN4UgsLof+jhLVj68KdxzE'
  + 'JiyLbdtTdRvm4FOsw76o0MTOGt6U3Yhrbte8/zw638p/ypNIVr1/UHTfMhVovaNJfJhP/de5kAtSfVXhSEgv449c5sfBbJaAbwCN'
  + '9aQ03nIjHgAAAABJRU5ErkJggg=='

export const TRAY_ICON_2X =
  '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'
  + 'QmCC'

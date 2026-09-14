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
  'iVBORw0KGgoAAAANSUhEUgAAABMAAAAQCAYAAAD0xERiAAABhUlEQVQ4jb3TuWpVURQG4O+ce0m0EI1GMKDENOIAgkkREQRDCi1E'
  + 'sBS0sLTxAdS8QBCxSYLkCeKAIjjEykKCVioqiKAW4gSCgqIJwRub/8ghJNxg4YLN3vxr2OtfA/9RDuIGPmE29y0cib5oF6BAiTHM'
  + 'YwGt2vsN7uB0u4CNnCtxXOp8wDm8xKH4lVXUKpNWjLfgEp7ha4zXow87sR1X8TvnROW/OMVtGEQ3OpPlL3zGO3wJPojd2I/+lEAT'
  + 'XTiFo+jFd6zBxmVK8Rq38QA3q0AoC3zEqlCbxF5sxqNaFzuD7cEwhoK9jc/FMDCFb3iK+5jBujYdX43jsV/AcwxUygMYj+JksBFM'
  + 'pEEdKfKxZAE9uICzodr629ZQnc+glriGJ9F15D4faiW25vMJ3MVoMxHLFL2JXZjGdWxIR8vcDzEXn958cLlGl9oUT+NHnf8y0odX'
  + '2YZGsEYVpKgN7L0M5mO8wHv8DNVN2IF9wQ+nFEU9s7qsxZkYzS5apbngIymBlSz7P8kfEh5luPOmD90AAAAASUVORK5CYII='

export const TRAY_ICON_2X =
  'iVBORw0KGgoAAAANSUhEUgAAACYAAAAgCAYAAAB+ZAqzAAAD6UlEQVRYhe2YWYiNYRjHf2cxloOYsYQQ2RtlixDJKIqyXliu3BDJ'
  + 'BWV3QSk3UuKGRLYRWZJSkiXLCBmyS6TszCLGMs58x83/1ePt+86ZGefSU2/f9rzP+3/+77O858B/aZjEGjkvDgS6HwRMBcYAfYG2'
  + 'el8NPAYuAceBB3qfAOrygP0vsY6MA04B34FMjvENOAj0N47lHVQrYLe3cFoj8EbaDKe7MJ/gHKhOQHkOMA5AYL7PBUq0rRlgab7A'
  + 'xYEUcFuGf4YACht1Gs+BdUB7YLZsDPlXcG7iDhMvdSFx5Bj6pZGWXuAxXKrrOdltVAI6UKMigrpW7IUBdaNOCTISmADcNUD7RYFL'
  + 'ZgEVU2rHgcnAUaAMeAq8BqqAH1qkBdBGMdhDZaNYC3cGmgHngS2KtYFibKJKSjxXCYkLTDYpAAq1YCegnRaOcm44sBa4bljcJhZL'
  + 'vZ35a6L74CY56QoM1ugP9AY6Aq2BpnIgo3j6AXwGPgAvxep9JctTY7MLMB9YIlvlJglCWXJSDKwGLgJf61E4c4008Aw4DCyQs05m'
  + 'AfujwskxNh5YoT23UgF8At7oGgM6aBsLxVzTHLFq5ZdYOqIiXR21YzFgJbBZz9XADWAPcAf4KHCFAj1Yk99pVJqWVKAE6KagLwZ6'
  + 'yZEw+a4eul3xh99HXcG8B+wDNgLTjMHZ8vIaME+xUV9pC4xVcb0QER6BGBzgT74qhfdK3TLgjDLnsDy7p+2zTMdNOYmbZzfCCmd3'
  + 'YBlwJaT5f1N8/5Ei4JAXsA812b1zsdekAWz5YoEOFfs7VRMtwGNAcztxnABWSOGLaHbnqLiMJxWDZUp/f1H7PAPYZcIiKTsTgQ3A'
  + 'HGAKcEKM1WrtUmfEGi4CpisLA4HAZF5X490cvYsqyk+kt1jPBboOAx4pbpcBi0yJqgUySZOijpEKKTkjr0NY+aI2lNazLcyWtVrp'
  + 'JDy9GhXsGPAKuClCUvq+19afwIDrCbTUvR9Xtm25a9QJIRbxvcCs5Y7ib5VkR4ETfmF0W1SjepJUQ8ac8Wukk1Ati2LM6STFMAZM'
  + 'H10zwC3Vsq1mByIlJQ8CFdEij6HR+gESJY6hEtWwlMf+SXNOm25AJ7IdIlzvPGQmHzDfE56unzyxiHdOZpqTbaW6iq+TFdgQ0xUy'
  + 'Atoj1+QskgKWy547x63y1gz1xAcXAGuATWq+TZTOZ9UtHiujqkwNChRTzXQ86qB+OQKYJMfS0jmt1pcx8VsvcV6sr8dvxkolwhs1'
  + '/s9yJmrOblOOGiWO0ZFqFVX/cDarVNCXNGThbGL/Duip08Jwc55vo96WlL20GnSVivMjHaUuAy9CbP6XvMhvtUB5dcdb5JEAAAAA'
  + 'SUVORK5CYII='

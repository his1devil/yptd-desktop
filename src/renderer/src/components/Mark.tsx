/**
 * yptd 的标记：戴宽檐帽的一张脸。
 *
 * 从应用图标重绘的单色矢量版：去掉原图的立体阴影，脸用描边、中间透出底色，16 像素下也认得出。
 * 全部用 `currentColor`，所以谁用它谁定色——侧边栏是图标色，agent 头像是各自的身份色。
 */
export function Mark({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      {/* 脸：粗描边，中间不填，底色透出来 */}
      <ellipse cx="11.7" cy="15.5" rx="6.4" ry="5" stroke="currentColor" strokeWidth="1.9" />
      <rect x="8.9" y="13.8" width="1.7" height="3.3" rx="0.85" fill="currentColor" />
      <rect x="13.4" y="13.8" width="1.7" height="3.3" rx="0.85" fill="currentColor" />
      {/* 帽顶，然后帽檐压在脸的上沿 */}
      <path d="M6.9 9.5a5.4 5.1 0 0 1 10.8 0z" fill="currentColor" />
      <ellipse cx="12" cy="9.8" rx="11" ry="2.1" fill="currentColor" transform="rotate(-6 12 9.8)" />
    </svg>
  )
}

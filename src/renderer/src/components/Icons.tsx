import type { SVGProps } from 'react'

/**
 * 图标全部照抄设计稿的内联 SVG：stroke=currentColor，线宽 1.3–1.6。
 * 不换图标库——线宽和 viewBox 一变，图标栏的分量就不对了。
 */
type P = SVGProps<SVGSVGElement> & { size?: number }

const base = (size: number, viewBox: number, props: P) => ({
  width: size,
  height: size,
  viewBox: `0 0 ${viewBox} ${viewBox}`,
  fill: 'none' as const,
  ...props,
})

export const IconInbox = ({ size = 22, ...p }: P) => (
  <svg {...base(size, 22, p)}>
    <path d="M2.4 12.8 4.4 4.5A1.8 1.8 0 0 1 6.2 3.1h9.6a1.8 1.8 0 0 1 1.8 1.4l2 8.3m-17.2 0v4a1.8 1.8 0 0 0 1.8 1.8h13.6a1.8 1.8 0 0 0 1.8-1.8v-4m-17.2 0h4.4l1.2 2.2h5.8l1.2-2.2h4.4" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
)

export const IconChat = ({ size = 22, ...p }: P) => (
  <svg {...base(size, 22, p)}>
    <path d="M19 11.3c0 3.8-3.6 6.9-8 6.9-1.1 0-2.2-.2-3.2-.5L3 19.3l1.5-3.8A6.5 6.5 0 0 1 3 11.3c0-3.8 3.6-6.9 8-6.9s8 3.1 8 6.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
)

/** 机器人：天线 + 圆角方头 + 两只圆眼 + 嘴 + 两侧耳朵 */
export const IconAgents = ({ size = 22, ...p }: P) => (
  <svg {...base(size, 24, p)}>
    <ellipse cx="11.7" cy="15.5" rx="6.4" ry="5" stroke="currentColor" strokeWidth="1.9" />
    <rect x="8.9" y="13.8" width="1.7" height="3.3" rx="0.85" fill="currentColor" />
    <rect x="13.4" y="13.8" width="1.7" height="3.3" rx="0.85" fill="currentColor" />
    <path d="M6.9 9.5a5.4 5.1 0 0 1 10.8 0z" fill="currentColor" />
    <ellipse cx="12" cy="9.8" rx="11" ry="2.1" fill="currentColor" transform="rotate(-6 12 9.8)" />
  </svg>
)

export const IconSun = ({ size = 21, ...p }: P) => (
  <svg {...base(size, 22, p)}>
    <circle cx="11" cy="11" r="4.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M11 1.6v2.2M11 18.2v2.2M20.4 11h-2.2M3.8 11H1.6M17.6 4.4l-1.6 1.6M6 16l-1.6 1.6M17.6 17.6 16 16M6 6 4.4 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
)

export const IconMoon = ({ size = 21, ...p }: P) => (
  <svg {...base(size, 22, p)}>
    <path d="M18.4 13.9A8.1 8.1 0 0 1 8.1 3.6a8.1 8.1 0 1 0 10.3 10.3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>
)

/** 设置：两条滑杆。圆钮里填 --rail，遮住穿过的线。 */
export const IconSettings = ({ size = 22, ...p }: P) => (
  <svg {...base(size, 22, p)}>
    <path d="M3.2 6.6h15.6M3.2 15.4h15.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="7.8" cy="6.6" r="2.5" fill="var(--rail)" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="14.2" cy="15.4" r="2.5" fill="var(--rail)" stroke="currentColor" strokeWidth="1.5" />
  </svg>
)

export const IconSearch = ({ size = 12, ...p }: P) => (
  <svg {...base(size, 14, p)}>
    <circle cx="6.2" cy="6.2" r="4.3" stroke="currentColor" strokeWidth="1.4" />
    <path d="M9.5 9.5 12.4 12.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

export const IconChevronDown = ({ size = 11, ...p }: P) => (
  <svg {...base(size, 12, p)}>
    <path d="M3 4.8 6 7.8 9 4.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** 右侧栏开合：面板图标，箭头方向随状态 */
export const IconPanel = ({ size = 17, open = true, ...p }: P & { open?: boolean }) => (
  <svg {...base(size, 18, p)}>
    <rect x="1.6" y="3" width="14.8" height="12" rx="2.2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M11.4 3v12" stroke="currentColor" strokeWidth="1.4" />
    {open
      ? <path d="M5.1 7.4 7.2 9l-2.1 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      : <path d="M7.2 7.4 5.1 9l2.1 1.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />}
  </svg>
)

export const IconClose = ({ size = 12, ...p }: P) => (
  <svg {...base(size, 14, p)}>
    <path d="m3 3 8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconCloseSmall = ({ size = 9, ...p }: P) => (
  <svg {...base(size, 10, p)}>
    <path d="m2.2 2.2 5.6 5.6M7.8 2.2l-5.6 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconPlus = ({ size = 15, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconMarket = ({ size = 18, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <rect x="2.4" y="2.4" width="5.6" height="5.6" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <rect x="10" y="2.4" width="5.6" height="5.6" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2.4" y="10" width="5.6" height="5.6" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <path d="M12.8 10v5.6M10 12.8h5.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

export const IconLibrary = ({ size = 18, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <path d="M3 3.8A1.3 1.3 0 0 1 4.3 2.5H9v13H4.3A1.3 1.3 0 0 1 3 14.2V3.8ZM9 2.5h4.7A1.3 1.3 0 0 1 15 3.8v10.4a1.3 1.3 0 0 1-1.3 1.3H9" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

export const IconMachine = ({ size = 18, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <rect x="2.4" y="2.6" width="13.2" height="4.8" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2.4" y="10.6" width="13.2" height="4.8" rx="1.4" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="5.3" cy="5" r=".95" fill="currentColor" />
    <circle cx="5.3" cy="13" r=".95" fill="currentColor" />
    <path d="M9.4 5h3.9M9.4 13h3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

// ---- 消息行悬浮条与输入框（设计稿 message row / composer 的内联 SVG） -------------------

export const IconEmoji = ({ size = 18, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <circle cx="9" cy="9" r="6.9" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="6.6" cy="7.4" r="1.05" fill="currentColor" />
    <circle cx="11.4" cy="7.4" r="1.05" fill="currentColor" />
    <path d="M6.1 10.5c.6 1.5 1.7 2.3 2.9 2.3s2.3-.8 2.9-2.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)

export const IconQuote = ({ size = 16, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <path d="M3.5 3.8v10.4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    <path d="M7.2 5.6h8M7.2 9h8M7.2 12.4h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

export const IconThread = ({ size = 16, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <path d="M2.9 5.8A1.8 1.8 0 0 1 4.7 4h8.6a1.8 1.8 0 0 1 1.8 1.8v4.1a1.8 1.8 0 0 1-1.8 1.8H7.2L3.8 14.4v-2.7h-.9V5.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

export const IconHandoff = ({ size = 17, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <path d="M9 1.9 15.4 5.5v7L9 16.1 2.6 12.5v-7L9 1.9Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M9 6.3 11.1 9 9 11.7 6.9 9 9 6.3Z" fill="currentColor" />
  </svg>
)

export const IconMore = ({ size = 17, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <circle cx="4" cy="9" r="1.25" fill="currentColor" />
    <circle cx="9" cy="9" r="1.25" fill="currentColor" />
    <circle cx="14" cy="9" r="1.25" fill="currentColor" />
  </svg>
)

export const IconPaperclip = ({ size = 15, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <path d="M11.5 5.5 6.2 10.8a2.1 2.1 0 0 1-3-3l5.6-5.6a3.3 3.3 0 0 1 4.7 4.7l-5.6 5.6a4.5 4.5 0 0 1-6.4-6.4l5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const IconCopy = ({ size = 14, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <rect x="5.4" y="5.4" width="8.2" height="8.2" rx="1.7" stroke="currentColor" strokeWidth="1.3" />
    <path d="M10.6 5.4V4a1.7 1.7 0 0 0-1.7-1.7H4a1.7 1.7 0 0 0-1.7 1.7v4.9A1.7 1.7 0 0 0 4 10.6h1.4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

export const IconImage = ({ size = 15, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <rect x="2" y="3" width="12" height="10" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="6" cy="6.8" r="1.2" fill="currentColor" />
    <path d="m3 12 3.6-3.4 2.4 2.2 2-1.8L14 12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
  </svg>
)

export const IconFile = ({ size = 18, ...p }: P) => (
  <svg {...base(size, 18, p)}>
    <path d="M4.5 2.5h6l3.5 3.5v9.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M10.5 2.5V6h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
  </svg>
)

export const IconUndo = ({ size = 14, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <path d="M6 4.5 3 7.5l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.4 7.5H10a3 3 0 0 1 0 6H7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

export const IconSend = ({ size = 14, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <path d="M2.5 8 13.5 2.8 10.9 13.3 8 9.4 2.5 8Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M8 9.4l5.5-6.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

export const IconHash = ({ size = 14, ...p }: P) => (
  <svg {...base(size, 16, p)}>
    <path d="M6.2 2.5 4.8 13.5M11.2 2.5 9.8 13.5M2.8 6h11M2.2 10.3h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
)

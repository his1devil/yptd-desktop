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
  <svg {...base(size, 22, p)}>
    <rect x="3.6" y="7.2" width="14.8" height="11" rx="3.2" stroke="currentColor" strokeWidth="1.6" />
    <path d="M11 4.4v2.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="11" cy="3" r="1.5" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="8.2" cy="11.6" r="1.3" fill="currentColor" />
    <circle cx="13.8" cy="11.6" r="1.3" fill="currentColor" />
    <path d="M8.8 15h4.4M1.7 10.6v3.2M20.3 10.6v3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
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

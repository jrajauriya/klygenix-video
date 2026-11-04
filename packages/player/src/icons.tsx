import type { ReactNode } from "react"

function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

export const PlayIcon = () => <Svg><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></Svg>
export const PauseIcon = () => <Svg><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" /></Svg>
export const BackIcon = () => <Svg><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">10</text></Svg>
export const ForwardIcon = () => <Svg><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">10</text></Svg>
export const VolumeIcon = () => <Svg><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" /><path d="M16.5 8.5a5 5 0 0 1 0 7" /><path d="M19 6a8.5 8.5 0 0 1 0 12" /></Svg>
export const MuteIcon = () => <Svg><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" /><path d="m22 9-6 6" /><path d="m16 9 6 6" /></Svg>
export const CaptionsIcon = () => <Svg><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 10.5a2 2 0 1 0 0 3" /><path d="M17 10.5a2 2 0 1 0 0 3" /></Svg>
export const SettingsIcon = () => <Svg><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></Svg>
export const ExpandIcon = () => <Svg><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></Svg>
export const ShrinkIcon = () => <Svg><path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" /></Svg>
export const PipIcon = () => <Svg><rect x="2.5" y="4.5" width="19" height="15" rx="2" /><rect x="12" y="11.5" width="7" height="5.5" rx="1" fill="currentColor" stroke="none" /></Svg>
export const CheckIcon = () => <Svg size={16}><path d="M20 6 9 17l-5-5" /></Svg>
export const ChevronIcon = () => <Svg size={16}><path d="m9 18 6-6-6-6" /></Svg>
export const SearchIcon = () => <Svg size={16}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></Svg>
export const SpinnerIcon = () => (
  <svg width={40} height={40} viewBox="0 0 50 50" aria-hidden="true" className="animate-spin">
    <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
    <path d="M25 5a20 20 0 0 1 20 20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
  </svg>
)

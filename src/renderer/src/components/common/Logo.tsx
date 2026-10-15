import { useId } from 'react'

/** Clauditor's spark: eight rays, the axis ones longer (same geometry as build/icon.svg). */
const SPARK = 'M128 128V82M128 128L149.21 106.79M128 128H174M128 128L149.21 149.21M128 128V174M128 128L106.79 149.21M128 128H82M128 128L106.79 106.79'
/** Heavier variant used below 28 px (build/icon-small.svg). */
const SPARK_SMALL = 'M128 128V76M128 128L152.04 103.96M128 128H180M128 128L152.04 152.04M128 128V180M128 128L103.96 152.04M128 128H76M128 128L103.96 103.96'

/** Clauditor mark: a spark between code brackets on a dark editor tile — the same artwork as the app icon. */
export function Logo({ size = 18 }: { size?: number }) {
  const id = useId().replace(/:/g, '')
  const small = size < 28
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" className="logo-mark">
      <defs>
        <linearGradient id={`tile${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34322E" />
          <stop offset="1" stopColor="#1E1D1B" />
        </linearGradient>
      </defs>
      {small ? (
        <rect x="4" y="4" width="248" height="248" rx="52" fill={`url(#tile${id})`} />
      ) : (
        <>
          <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#tile${id})`} />
          <rect x="8.75" y="8.75" width="238.5" height="238.5" rx="55.25" fill="none" stroke="#FFFFFF" strokeOpacity="0.07" strokeWidth="1.5" />
        </>
      )}
      <g fill="none" stroke="#F0EEE6" strokeWidth={small ? 24 : 15} strokeLinecap="round" strokeLinejoin="round">
        <path d={small ? 'M62 86 L34 128 L62 170' : 'M68 92 L40 128 L68 164'} />
        <path d={small ? 'M194 86 L222 128 L194 170' : 'M188 92 L216 128 L188 164'} />
      </g>
      <path d={small ? SPARK_SMALL : SPARK} fill="none" stroke="#F0773F" strokeWidth={small ? 19 : 13} strokeLinecap="round" />
    </svg>
  )
}

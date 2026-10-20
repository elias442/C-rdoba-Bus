import { cx } from '../lib/format'

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx('grid h-11 w-11 place-items-center rounded-2xl bg-ink-900 shadow-sm', className)}>
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M6 22c3-8 6.2-12 10-12s7 4 10 12" fill="none" stroke="#2f6bff" strokeWidth="2.4" strokeLinecap="round" />
        <circle cx="16" cy="10" r="2.3" fill="white" />
      </svg>
    </span>
  )
}

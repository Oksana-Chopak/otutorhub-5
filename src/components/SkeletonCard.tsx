/**
 * Skeleton loading cards — used across all pages while data loads.
 * Prevents blank white flash, makes app feel instant.
 */
export function SkeletonCard({ lines = 2 }: { lines?: number }) {
  return (
    <div className="animate-pulse rounded-[16px] border border-border bg-white p-4">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded-lg bg-muted" />
          {Array.from({ length: lines - 1 }).map((_, i) => (
            <div key={i} className="h-3 w-1/2 rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} lines={2} />
      ))}
    </div>
  );
}

export function SkeletonStatCards() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-[16px] border border-border bg-white p-4">
          <div className="h-3 w-16 rounded bg-muted mb-3" />
          <div className="h-7 w-20 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonHero() {
  return (
    <div className="animate-pulse rounded-b-[24px] bg-[#0f0f1a] px-5 py-5 mb-5">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded-lg bg-white/10" />
          <div className="h-4 w-32 rounded bg-white/10" />
          <div className="h-3 w-56 rounded bg-white/5" />
        </div>
        <div className="h-11 w-11 rounded-full bg-white/10" />
      </div>
    </div>
  );
}

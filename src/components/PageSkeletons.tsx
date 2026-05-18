/**
 * PageSkeletons.tsx
 *
 * Замінюють Loader2 spinner на кожній сторінці.
 * Використання:
 *   import { DashboardSkeleton } from "@/components/PageSkeletons";
 *   if (loading) return <DashboardSkeleton />;
 */

import { Skeleton } from "@/components/ui/skeleton";

// ─── Спільні блоки ────────────────────────────────────────────────────────────

function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-card p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <Skeleton className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}

function LessonCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-8 w-24 rounded-lg" />
      </div>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-3">
      <Skeleton className="mb-2 h-3 w-16" />
      <Skeleton className="h-6 w-12" />
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Hero banner */}
      <div className="rounded-2xl border border-border bg-card/50 p-6 sm:p-8">
        <Skeleton className="mb-3 h-8 w-64" />
        <Skeleton className="mb-4 h-4 w-96 max-w-full" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32 rounded-lg" />
          <Skeleton className="h-7 w-28 rounded-lg" />
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Two-column layout */}
      <div className="grid gap-6 lg:gap-8 xl:grid-cols-2">
        {/* Upcoming lessons */}
        <section className="space-y-3">
          <Skeleton className="h-6 w-40" />
          {Array.from({ length: 3 }).map((_, i) => (
            <LessonCardSkeleton key={i} />
          ))}
        </section>

        {/* Next steps */}
        <section className="space-y-3">
          <Skeleton className="h-6 w-32" />
          {Array.from({ length: 2 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </section>
      </div>
    </div>
  );
}

// ─── Students ─────────────────────────────────────────────────────────────────

function StudentRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-4">
      <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="hidden gap-2 sm:flex">
        <Skeleton className="h-8 w-16 rounded-lg" />
        <Skeleton className="h-8 w-8 rounded-lg" />
      </div>
    </div>
  );
}

export function StudentsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-9 w-36 rounded-lg" />
      </div>

      {/* Search bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Student list */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <StudentRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// ─── Schedule ─────────────────────────────────────────────────────────────────

export function ScheduleSkeleton() {
  return (
    <div className="space-y-4">
      {/* Tabs / view switcher */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-9 w-40 rounded-lg" />
        <Skeleton className="h-9 w-36 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      {/* Lesson list */}
      <div className="space-y-3">
        {/* Date group label */}
        <Skeleton className="h-4 w-28" />
        {Array.from({ length: 3 }).map((_, i) => (
          <LessonCardSkeleton key={i} />
        ))}

        <Skeleton className="mt-4 h-4 w-32" />
        {Array.from({ length: 2 }).map((_, i) => (
          <LessonCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

// ─── Finances ─────────────────────────────────────────────────────────────────

export function FinancesSkeleton() {
  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>

      {/* Chart placeholder */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <Skeleton className="mb-4 h-5 w-40" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>

      {/* Payment rows */}
      <div className="space-y-2">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <Skeleton className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

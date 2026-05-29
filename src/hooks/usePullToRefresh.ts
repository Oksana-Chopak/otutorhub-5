import { useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh for mobile.
 * Usage: const { isPulling, pullProgress } = usePullToRefresh(onRefresh);
 */
export function usePullToRefresh(onRefresh: () => Promise<void> | void) {
  const [isPulling, setIsPulling] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const startY = useRef(0);
  const threshold = 70; // px to trigger refresh

  useEffect(() => {
    const el = document.documentElement;

    const onTouchStart = (e: TouchEvent) => {
      if (el.scrollTop === 0) startY.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startY.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta > 0 && el.scrollTop === 0) {
        setPullProgress(Math.min(delta / threshold, 1));
        setIsPulling(true);
      }
    };

    const onTouchEnd = async () => {
      if (pullProgress >= 1) {
        if ('vibrate' in navigator) navigator.vibrate(20);
        await onRefresh();
      }
      startY.current = 0;
      setPullProgress(0);
      setIsPulling(false);
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [onRefresh, pullProgress]);

  return { isPulling, pullProgress };
}

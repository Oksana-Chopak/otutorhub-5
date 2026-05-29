/**
 * Haptic feedback hook — uses Vibration API on mobile.
 * Silent fallback on desktop/unsupported browsers.
 */
export function useHaptic() {
  const tap = () => {
    if ('vibrate' in navigator) navigator.vibrate(10);
  };
  const success = () => {
    if ('vibrate' in navigator) navigator.vibrate([15, 50, 30]);
  };
  const error = () => {
    if ('vibrate' in navigator) navigator.vibrate([50, 30, 50]);
  };
  return { tap, success, error };
}

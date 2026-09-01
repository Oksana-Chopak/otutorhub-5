import { useEffect } from "react";

/**
 * C2 (клавіатура): саморобні оверлеї закривалися лише кліком по тлу — миша
 * була єдиним виходом. Radix-діалоги вміють Escape самі; ці — ні, тож хук
 * додає їм ту саму звичку. Слухач вішається лише коли оверлей відкритий.
 */
export function useEscapeKey(active: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscape();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [active, onEscape]);
}

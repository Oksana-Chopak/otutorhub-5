import { useEffect, useState } from "react";

/**
 * C3: наскрізний «рефетч після мутацій» без фреймворка — глобальний лічильник
 * версії даних. Мутації (провів/скасував/створив/оплата/закрив день) роблять
 * bump; головні лоадери сторінок додають useDataVersion() у deps і
 * підтягуються самі, на якій би поверхні мутація не сталась.
 */
let version = 0;
const subs = new Set<(v: number) => void>();

export function bumpDataVersion() {
  version += 1;
  subs.forEach((f) => f(version));
}

export function useDataVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => {
    const f = (n: number) => setV(n);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return v;
}

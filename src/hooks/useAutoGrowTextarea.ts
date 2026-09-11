import { useLayoutEffect, useRef } from "react";

/**
 * Текстове поле росте під свій вміст.
 *
 * НАВІЩО (рішення власниці 11.09): домашка буває на двадцять рядків, а поле
 * було на чотири. І репетиторка, і учень мусили скролити всередині віконця,
 * щоб прочитати те, що самі ж і написали. Поле має показувати весь текст —
 * і поки пишеш, і після збереження.
 *
 * Стеля навмисно ВИСОКА. Низька (500–600px) виглядає розумно, але повертає
 * рівно ту проблему, з якої все почалось: домашка на 20 рядків — це ~950px на
 * телефоні, і поле знову доводиться скролити всередині. Краще хай сторінка
 * прокручується звично, ніж текст ховається у віконці. Стеля лишається тільки
 * як страховка від абсурду (вставили книжку).
 */
export function useAutoGrowTextarea(value: string, maxHeight = 4000) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Спершу «auto» — інакше scrollHeight міряє попередню, вищу за потрібну висоту
    // і поле вміє тільки рости.
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [value, maxHeight]);

  return ref;
}

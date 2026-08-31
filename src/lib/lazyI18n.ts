import i18n from "@/i18n";

/**
 * A1 (ліниві локалі): значення, обчислені на рівні модуля через i18n.t(),
 * застигали мовою, активною в момент імпорту, — а з лінивими локалями взагалі
 * рендерили б сирі ключі, бо модуль виконується ДО завантаження чанка мови.
 * Ці проксі обчислюють переклад у момент звернення, тож:
 *  1) значення завжди актуальною мовою (перемикання без перезавантаження);
 *  2) module-level i18n.t() не викликається до готовності i18next.
 * Кеш на мову: перебудова лише коли i18n.language змінилась.
 */
function cached<T extends object>(build: () => T): () => T {
  let value: T | null = null;
  let lang: string | undefined;
  return () => {
    const cur = i18n.language;
    if (!value || lang !== cur) {
      value = build();
      lang = cur;
    }
    return value;
  };
}

export function lazyArray<T>(build: () => readonly T[]): readonly T[] {
  const get = cached(() => build() as T[]);
  return new Proxy([] as T[], {
    get: (_t, prop, recv) => Reflect.get(get(), prop, recv),
    has: (_t, prop) => Reflect.has(get(), prop),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_t, prop) => Object.getOwnPropertyDescriptor(get(), prop),
  }) as readonly T[];
}

export function lazyRecord<V>(build: () => Record<string, V>): Record<string, V> {
  const get = cached(build);
  return new Proxy({} as Record<string, V>, {
    get: (_t, prop, recv) => Reflect.get(get(), prop, recv),
    has: (_t, prop) => Reflect.has(get(), prop),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_t, prop) => Object.getOwnPropertyDescriptor(get(), prop),
  });
}

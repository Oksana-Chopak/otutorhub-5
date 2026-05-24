import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// ResizeObserver is used by Radix UI — mock it in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// localStorage is not available in jsdom without --localstorage-file.
// Proxy-based mock so Object.keys(localStorage) returns stored item keys,
// matching browser behaviour that useAuth.tsx relies on (line 125).
const _lsTarget = Object.create(null) as Record<string, string>;
const localStorageMock = new Proxy(_lsTarget, {
  get(target, prop: string) {
    if (prop === "getItem")   return (key: string) => (key in target ? target[key] : null);
    if (prop === "setItem")   return (key: string, value: string) => { target[key] = String(value); };
    if (prop === "removeItem") return (key: string) => { delete target[key]; };
    if (prop === "clear")     return () => { Object.keys(target).forEach((k) => delete target[k]); };
    if (prop === "length")    return Object.keys(target).length;
    if (prop === "key")       return (i: number) => Object.keys(target)[i] ?? null;
    return target[prop];
  },
  ownKeys: (target) => Object.keys(target),
  getOwnPropertyDescriptor: (target, prop: string) =>
    prop in target
      ? { value: target[prop as string], writable: true, enumerable: true, configurable: true }
      : undefined,
}) as unknown as Storage;
Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

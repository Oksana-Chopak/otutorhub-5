// ЄДИНИЙ маркер збірки. Бампається кожним значущим пушем.
// Синхронність із index.html та дайджестом стереже розтяжка №12.
export const BUILD_TAG = "v25.09-uxstep51";

// Штампи збірки — ставляться САМІ під час збірки (vite.config.ts → buildStamp),
// ручного бампу не потребують. BUILD_STAMP = хеш джерел (ним робот у CI звіряє
// прод із main), BUILD_SHA = коміт, якщо git був у збірці. У тестах — «dev».
export const BUILD_STAMP: string = typeof __BUILD_STAMP__ === "string" ? __BUILD_STAMP__ : "dev";
export const BUILD_SHA: string = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "dev";

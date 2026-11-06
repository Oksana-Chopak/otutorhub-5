/**
 * Дата й час — 24 години завжди, вибір скролом (06.11).
 *
 * Власниця: «календар неправильного формату, ми домовилися всюди застосовувати
 * 24-годинний формат і дружній до мобілок скрол вибору дати і часу у кожній із
 * існуючих форм». Нативне `datetime-local` бере формат з операційної системи —
 * на її Mac це AM/PM, і атрибутами це не лікується. Тому поле наше; тест
 * тисне по ньому так, як тисне людина, і дивиться, що виходить назовні.
 */
import * as React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, within } from "@testing-library/react";

import { DateTimeField, DateField, TimeField } from "@/components/DateTimeField";

const onChange = vi.fn();
beforeEach(() => onChange.mockClear());

const openPanel = () => fireEvent.click(screen.getByRole("button", { name: /дат|час/i }));
// Панель — два кроки (дата → час): на телефоні календар і колонки часу в один
// екран не влазять, і час опинявся нижче краю.
const goTime = () => fireEvent.click(screen.getAllByRole("tab")[1]);
const wheel = (name: RegExp) => screen.getByRole("listbox", { name });

describe("поле дати-часу: 24 години і скрол", () => {
  it("показує час як 18:30 — без AM/PM у жодній мові", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    const trigger = screen.getByRole("button", { name: "Дата й час" });
    expect(trigger.textContent).toMatch(/18:30/);
    expect(trigger.textContent, "жодного AM/PM").not.toMatch(/\b(AM|PM|am|pm)\b/);
    expect(trigger.textContent, "дата словами, не 2026-11-12").toMatch(/лист/);
  });

  it("години 00–23 і хвилини по 5 — списками, по яких можна скролити", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    openPanel(); goTime();
    const hours = wheel(/година/i);
    const opts = within(hours).getAllByRole("option").map((o) => o.textContent);
    expect(opts[0]).toBe("00");
    expect(opts.at(-1), "23 година існує — це і є 24-годинний формат").toBe("23");
    expect(opts.length).toBe(24);
    expect(within(hours).getByRole("option", { selected: true }).textContent).toBe("18");
    const mins = within(wheel(/хвилина/i)).getAllByRole("option").map((o) => o.textContent);
    expect(mins).toEqual(["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"]);
  });

  it("дотик по годині й по хвилині віддає значення у тому ж форматі", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    openPanel(); goTime();
    fireEvent.click(within(wheel(/година/i)).getByRole("option", { name: "09" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-12T09:30");
    fireEvent.click(within(wheel(/хвилина/i)).getByRole("option", { name: "45" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-12T18:45");
  });

  it("стрілки працюють так само, як дотик (клавіатура не гірша за палець)", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    openPanel(); goTime();
    fireEvent.keyDown(wheel(/година/i), { key: "ArrowDown" });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-12T19:30");
    fireEvent.keyDown(wheel(/хвилина/i), { key: "ArrowUp" });
    expect(onChange).toHaveBeenLastCalledWith("2026-11-12T18:25");
  });

  it("вибір дня зберігає час, а не скидає його", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    openPanel();
    fireEvent.click(screen.getByRole("gridcell", { name: "20" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-20T18:30");
  });

  it("вибрав день — панель сама веде на час, а не лишає його за краєм екрана", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    openPanel();
    expect(screen.queryByRole("listbox", { name: /година/i }), "спершу календар").toBeNull();
    fireEvent.click(screen.getByRole("gridcell", { name: "20" }));
    expect(screen.getByRole("listbox", { name: /година/i }), "далі одразу час").toBeInTheDocument();
  });

  it("підписи кроків показують те, що вже вибрано (повний оберт значення)", () => {
    function Controlled() {
      const [v, setV] = React.useState("2026-11-12T18:30");
      return <DateTimeField value={v} onChange={setV} label="Дата й час" />;
    }
    render(<Controlled />);
    openPanel();
    fireEvent.click(screen.getByRole("gridcell", { name: "20" }));
    expect(screen.getAllByRole("tab")[0].textContent, "крок «дата» показує 20-те").toMatch(/20/);
    fireEvent.click(within(wheel(/хвилина/i)).getByRole("option", { name: "45" }));
    expect(screen.getAllByRole("tab")[1].textContent, "крок «час» показує 18:45").toMatch(/18:45/);
    expect(screen.getByRole("button", { name: "Дата й час" }).textContent).toMatch(/20 лист.*18:45/);
  });

  it("тиждень починається з понеділка в усіх трьох мовах", () => {
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} label="Дата й час" />);
    openPanel();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim().toLowerCase());
    expect(heads[0], "перший день тижня").toMatch(/^пн|^mån|^mo/);
  });

  it("нижня межа не вибирається — замість тихого підтягування", () => {
    render(<DateTimeField value="2026-11-12T18:30" min="2026-11-12T10:00" onChange={onChange} label="Дата й час" />);
    openPanel(); goTime();
    const hours = wheel(/година/i);
    expect(within(hours).getByRole("option", { name: "09" })).toBeDisabled();
    expect(within(hours).getByRole("option", { name: "10" })).not.toBeDisabled();
  });

  it("порожнє поле просить вибрати, а не вигадує дату саме", () => {
    render(<DateTimeField value="" onChange={onChange} label="Дата й час" />);
    expect(screen.getByRole("button", { name: "Дата й час" }).textContent).toMatch(/Вибрати дату й час/);
    expect(onChange, "поки людина не вибрала — нічого не змінюємо").not.toHaveBeenCalled();
  });

  it("тривалість лишилась поруч, як була", () => {
    const onDur = vi.fn();
    render(<DateTimeField value="2026-11-12T18:30" onChange={onChange} durationMin={60} onDurationChange={onDur} />);
    const dur = screen.getByRole("spinbutton");
    fireEvent.change(dur, { target: { value: "90" } });
    expect(onDur).toHaveBeenCalledWith(90);
  });
});

describe("поля «лише дата» і «лише час»", () => {
  it("TimeField: 24 години, дотик віддає HH:mm", () => {
    render(<TimeField value="08:00" onChange={onChange} label="Від" />);
    fireEvent.click(screen.getByRole("button", { name: "Від" }));
    fireEvent.click(within(wheel(/година/i)).getByRole("option", { name: "21" }));
    expect(onChange).toHaveBeenLastCalledWith("21:00");
  });

  it("DateField: вибір дня віддає YYYY-MM-DD і закриває панель", () => {
    render(<DateField value="2026-11-12" onChange={onChange} label="Дата" />);
    fireEvent.click(screen.getByRole("button", { name: "Дата" }));
    fireEvent.click(screen.getByRole("gridcell", { name: "20" }));
    expect(onChange).toHaveBeenLastCalledWith("2026-11-20");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("DateField з межею: дні до неї не клікаються", () => {
    render(<DateField value="2026-11-12" min="2026-11-10" onChange={onChange} label="Дата" />);
    fireEvent.click(screen.getByRole("button", { name: "Дата" }));
    fireEvent.click(screen.getByRole("gridcell", { name: "5" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("розтяжка: формат часу ніде не залежить від системи", () => {
  // Коментарі зрізаємо: двічі в жовтні ворота червоніли на ПРОЗІ про помилку,
  // а не на помилці. Перевіряємо код.
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) return e === "node_modules" ? [] : walk(full);
      return /\.tsx?$/.test(e) && !/\.test\./.test(e) ? [full] : [];
    });

  it("сирих date/time-інпутів немає НІДЕ, навіть у самому полі", () => {
    const bad = walk("src").filter((f) => /type="date"|type="time"|datetime-local/.test(strip(readFileSync(f, "utf8"))));
    expect(bad, "нативний інпут бере формат з ОС — саме через це була скарга").toEqual([]);
  });

  it("ніхто не просить 12-годинний формат", () => {
    const bad = walk("src").filter((f) => /hour12\s*:\s*true|hourCycle\s*:\s*["']h12["']/.test(strip(readFileSync(f, "utf8"))));
    expect(bad).toEqual([]);
  });

  it("календар монтує ЛИШЕ затверджене поле — другого формату взятися нізвідки", () => {
    // Саме імпорт компонента, а не іконку з тим самим імʼям: «<Calendar» є в
    // чатах і профілі як іконка lucide — це не календар.
    const own = walk("src").filter((f) => !f.endsWith("DateTimeField.tsx")
      && /from "@\/components\/ui\/calendar"/.test(strip(readFileSync(f, "utf8"))));
    expect(own, "другий календар = другий формат; ось так і розʼїхалось").toEqual([]);
  });
});

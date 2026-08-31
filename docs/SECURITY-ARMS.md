# Арми ролі `manager` — інвентаризація і план

Джерело: аудит безпеки (серпень 2026) + власний рекон хвилі 45.

## Головна знахідка рекону

**Моделі належності до хабу в схемі не існує.** Немає ні `hub_id`, ні
`manager_id`, ні зв'язкової таблиці «тьютор ↔ хаб». `start_manager_chat`
прямо каже: `-- The hub has a single manager account`, і бере
`user_roles WHERE role='manager' ORDER BY user_id LIMIT 1`.

Тобто голий `has_role(manager)` писали не з недбалості: **скоупити не було
по чому.** Це пояснює всю картину і визначає порядок робіт.

## Інвентаризація (174 згадки в історії міграцій, 53 таблиці)

| Категорія | Політик | Правильна заміна | Стан |
|---|---|---|---|
| 🔴 Приватне | 29 | **нічого** | ✅ хвиля 45 |
| 🟣 Платформне | 16 | `is_superadmin()` | ✅ частково (error_log — раніше; paywall_events, pro_bonus_ledger — 45) |
| 🟠 Операційне | 129 | `has_role(manager) AND is_hub_scoped(tutor_id)` | ⛔ **блоковано схемою** |

## Що зроблено (міграція `20260831160000_arm_sweep_private.sql`)

- `liqpay_payments` — менеджер більше не читає рядки з токеном картки.
- Чати (4 таблиці) — знято читання чужих переписок; власні треди менеджера
  покриває політика учасника.
- `profile_financial_contacts` — банківські реквізити закрито.
- `paywall_events`, `pro_bonus_ledger` — переведено на `is_superadmin()`.

**Видимий наслідок:** сторінка «Чати» показує менеджеру лише його власні
треди, а не всі переписки тьюторів з учнями.

## Що лишається (операційні 129) і чого воно потребує

Поки менеджер один — витоку немає: «всі дані платформи» і «дані мого хабу»
збігаються. З **другою школою** вони розходяться, і кожна з цих політик стає
реальним витоком: чужі уроки, ставки, гаманці, ростер.

Мінімальна схема, яка розблоковує скоуп:

```sql
alter table public.tutor_workspace_settings
  add column if not exists hub_id uuid references public.profiles(id);

-- Наявні хабові тьютори належать єдиному наявному менеджеру:
update public.tutor_workspace_settings s
   set hub_id = (select user_id from public.user_roles
                  where role = 'manager' order by user_id limit 1)
 where s.independent_workspace = false and s.hub_id is null;

create or replace function public.is_hub_scoped(_tutor uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.tutor_workspace_settings s
     where s.tutor_id = _tutor and s.hub_id = auth.uid()
  );
$$;
```

Далі кожна операційна політика переписується як
`has_role(auth.uid(),'manager') AND public.is_hub_scoped(<tutor_id колонка>)`.

**Свідомо не зроблено зараз:** писати `is_hub_scoped()`, який завжди повертає
true, було б гірше за відсутність — воно виглядало б як виправлення. Схемне
рішення (де саме живе `hub_id`, що з учнями кількох хабів) належить власниці,
а не агенту.

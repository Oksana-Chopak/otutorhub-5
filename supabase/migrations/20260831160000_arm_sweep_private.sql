-- 45: арм-свіп, частина 1 — ПРИВАТНЕ.  (ІДЕМПОТЕНТНО — можна запускати повторно)
--
-- Аудит: ~40 живих політик мають голий has_role(manager) над даними ВСІЄЇ
-- платформи. Правильна заміна — одна з трьох: is_superadmin() (платформне),
-- has_role(manager) AND is_hub_scoped(...) (операційне), або нічого (приватне).
--
-- Ця міграція робить ЛИШЕ третю категорію: там, де менеджеру доступ не потрібен
-- узагалі, скоуп хабу не потрібен — і чекати на нього не треба.
-- Операційна категорія (129 політик) впирається у відсутню модель належності
-- до хабу — розбір і пропозиція схеми в docs/SECURITY-ARMS.md.

-- ── 1. Токен картки ───────────────────────────────────────────────────────────
-- liqpay_payments сусідить із liqpay_card_token. Підписку кожен тьютор платить
-- сам; менеджер її не адмініструє. Суперадмін бачить платежі через admin-stats
-- (service-role), тож панель CRM від цього не страждає.
drop policy if exists "Managers view all payments" on public.liqpay_payments;

-- ── 2. Листування ─────────────────────────────────────────────────────────────
-- Менеджерські треди створює start_manager_chat з менеджером у слоті student_id,
-- тож політика учасника («auth.uid() = tutor_id OR = student_id») повністю
-- покриває ВЛАСНІ чати менеджера. Знімаємо лише читання ЧУЖИХ переписок.
-- Наслідок у продукті: сторінка «Чати» показує менеджеру його власні треди.
drop policy if exists "Manager views all messages" on public.chat_messages;
drop policy if exists "Manager views all threads" on public.chat_threads;
drop policy if exists "Manager views all attachments" on public.chat_message_attachments;
drop policy if exists "Manager views all reactions" on public.chat_message_reactions;

-- ── 3. Фінансові реквізити ────────────────────────────────────────────────────
-- Банківські дані людей. Виплати проводить mark_tutor_payouts_paid
-- (SECURITY DEFINER) — клієнтське читання менеджером не потрібне.
drop policy if exists "Managers view financial contacts" on public.profile_financial_contacts;
drop policy if exists "Managers manage financial contacts" on public.profile_financial_contacts;

-- ── 4. Платформні журнали → суперадмін ───────────────────────────────────────
drop policy if exists "Managers view paywall events" on public.paywall_events;
drop policy if exists "Superadmin views paywall events" on public.paywall_events;
create policy "Superadmin views paywall events" on public.paywall_events
  for select to authenticated using (public.is_superadmin());

drop policy if exists "Managers view bonus ledger" on public.pro_bonus_ledger;
drop policy if exists "Superadmin views bonus ledger" on public.pro_bonus_ledger;
create policy "Superadmin views bonus ledger" on public.pro_bonus_ledger
  for select to authenticated using (public.is_superadmin());

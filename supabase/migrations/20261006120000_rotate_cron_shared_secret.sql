-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ 06.10 — РОТАЦІЯ СЕКРЕТУ pg_cron, що з травня лежить у репо відкритим      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝
--
-- Що не так. 12.05 Lovable записав значення секрету `cron_shared_secret` прямо в
-- міграцію `20260512234710_…sql` (`vault.update_secret(…, '<64 hex>', …)`). Відтоді
-- воно у кожному клоні репо, у кожному контексті кожного агента. Цим секретом
-- pg_cron ходить до нічних edge-функцій (digest, reminders, telegram-poll,
-- db-backup, process-email-queue…) — тобто будь-хто з доступом до репо може
-- викликати їх напряму. Правило проєкту: секрети живуть ЛИШЕ у секретах, ніколи
-- в репо/документах/чаті.
--
-- Що робимо. Нове значення генерується ПРЯМО В БАЗІ (gen_random_uuid × 2 → 64 hex,
-- ~244 біти випадковості) і ніде не зʼявляється — ні в цьому файлі, ні в чаті,
-- ні в логах. Ніщо поза базою його не тримає:
--   • усі 15 cron-джобів читають `public.get_cron_shared_secret()` під час запуску
--     (`'Bearer ' || public.get_cron_shared_secret()` у кожному cron.schedule);
--   • кожна нічна edge-функція порівнює заголовок із тим самим RPC під час запиту.
-- Тож ротація атомарна й не потребує передеплою. Якщо один запуск telegram-poll
-- (щохвилини) встиг узяти старе значення за мить до ротації — буде рівно один
-- 403, і це видно в «🛡» ранкового дайджесту як 1× збій; наступна хвилина — ок.
--
-- GitHub це НЕ зачіпає: воркфлоу ходять із env CRON_SECRET (секрети edge-функцій =
-- GitHub Secrets), а функції, які вони кличуть (ci-report, errors-report,
-- scheduled-notifications), перевіряють саме його (vault — лише запасний).
--
-- LIVE-MARKER-NONE: секрет не має форми в types.ts. Доказ — ранковий дайджест
-- наступного дня: усі нічні процеси «✓» (вони б падали 403, якби ротація зламала
-- ланцюг), і ворота db-sync доводять цей файл змістом за хеш-файлом Lovable.

-- 1) Ротація: оновити наявний запис vault (у проді він є з травня), а якщо його
--    чомусь немає — створити. Значення народжується в самому запиті.
SELECT vault.update_secret(
  (SELECT id FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret' LIMIT 1),
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'cron_shared_secret',
  'Shared secret pg_cron -> internal edge functions. Rotated 2026-10-06; the value lives only in vault and is read at run time by get_cron_shared_secret().'
)
WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret');

SELECT vault.create_secret(
  replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  'cron_shared_secret',
  'Shared secret pg_cron -> internal edge functions. Created 2026-10-06 because no row existed; read at run time by get_cron_shared_secret().'
)
WHERE NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret');

-- 2) Права на читання секрету — як і були: лише service_role (edge-функції).
REVOKE EXECUTE ON FUNCTION public.get_cron_shared_secret() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cron_shared_secret() TO service_role;

-- 3) Вбудована перевірка: запис рівно один, щойно оновлений, і функція віддає
--    свіже значення потрібної форми.
DO $$
DECLARE _v text; _touched timestamptz;
BEGIN
  IF (SELECT count(*) FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret') <> 1 THEN
    RAISE EXCEPTION 'cron_shared_secret: у vault має бути рівно один запис із цим імʼям';
  END IF;
  SELECT coalesce(updated_at, created_at) INTO _touched FROM vault.decrypted_secrets WHERE name = 'cron_shared_secret';
  IF _touched IS NULL OR _touched < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'cron_shared_secret: запис не оновився в цьому запуску (updated_at = %)', _touched;
  END IF;
  SELECT public.get_cron_shared_secret() INTO _v;
  IF _v IS NULL OR _v !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'cron_shared_secret: get_cron_shared_secret() віддає не 64-символьний hex (%)', coalesce(left(_v, 8) || '…', 'NULL');
  END IF;
END $$;

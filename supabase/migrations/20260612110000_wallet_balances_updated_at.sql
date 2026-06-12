-- FIX (прод-скрін від власниці): wallet_delete_transaction падає з
-- «column "updated_at" of relation "student_wallet_balances" does not exist».
-- Таблицю student_wallet_balances колись створили поза міграціями (через
-- Lovable-чат) без updated_at, а функції-писарі цю колонку очікують.
-- Згенеровані types.ts підтверджують: на проді її немає.
-- Ідемпотентно вирівнюємо схему під те, що очікує код:

ALTER TABLE public.student_wallet_balances
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Захисно (за types вона є, але IF NOT EXISTS нічого не зламає):
ALTER TABLE public.student_wallet_balances
  ADD COLUMN IF NOT EXISTS last_transaction_at timestamptz;

-- ============================================
-- ENUM types
-- ============================================
CREATE TYPE public.lesson_status AS ENUM ('pending', 'scheduled', 'completed', 'cancelled');
CREATE TYPE public.payment_status AS ENUM ('unpaid', 'paid');

-- ============================================
-- TABLE: student_rates (індивідуальна ціна для пари тутор-учень)
-- ============================================
CREATE TABLE public.student_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL,
  student_id UUID NOT NULL,
  price_per_lesson NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tutor_id, student_id)
);

ALTER TABLE public.student_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manager manages student rates"
ON public.student_rates FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Tutor views own student rates"
ON public.student_rates FOR SELECT
TO authenticated
USING (auth.uid() = tutor_id);

CREATE POLICY "Student views own rates"
ON public.student_rates FOR SELECT
TO authenticated
USING (auth.uid() = student_id);

CREATE TRIGGER trg_student_rates_updated
BEFORE UPDATE ON public.student_rates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_student_rates_tutor ON public.student_rates(tutor_id);
CREATE INDEX idx_student_rates_student ON public.student_rates(student_id);

-- ============================================
-- TABLE: lessons
-- ============================================
CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tutor_id UUID NOT NULL,
  student_id UUID NOT NULL,
  subject TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes > 0),
  status public.lesson_status NOT NULL DEFAULT 'scheduled',
  notes TEXT,
  -- фінанси
  student_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  tutor_payout NUMERIC(10,2) NOT NULL DEFAULT 0,
  student_payment_status public.payment_status NOT NULL DEFAULT 'unpaid',
  tutor_payout_status public.payment_status NOT NULL DEFAULT 'unpaid',
  student_paid_at TIMESTAMPTZ,
  tutor_paid_at TIMESTAMPTZ,
  -- мета
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_lessons_tutor ON public.lessons(tutor_id);
CREATE INDEX idx_lessons_student ON public.lessons(student_id);
CREATE INDEX idx_lessons_starts_at ON public.lessons(starts_at);
CREATE INDEX idx_lessons_status ON public.lessons(status);

CREATE TRIGGER trg_lessons_updated
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- RLS POLICIES для lessons
-- ============================================

-- SELECT
CREATE POLICY "Manager views all lessons"
ON public.lessons FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Tutor views own lessons"
ON public.lessons FOR SELECT
TO authenticated
USING (auth.uid() = tutor_id);

CREATE POLICY "Student views own lessons"
ON public.lessons FOR SELECT
TO authenticated
USING (auth.uid() = student_id);

-- INSERT
CREATE POLICY "Manager creates any lesson"
ON public.lessons FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Tutor creates own lessons"
ON public.lessons FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'tutor')
  AND auth.uid() = tutor_id
  AND auth.uid() = created_by
);

-- Учень може створити запит — статус має бути 'pending', оплати unpaid
CREATE POLICY "Student requests lesson"
ON public.lessons FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'student')
  AND auth.uid() = student_id
  AND auth.uid() = created_by
  AND status = 'pending'
  AND student_payment_status = 'unpaid'
  AND tutor_payout_status = 'unpaid'
);

-- UPDATE
CREATE POLICY "Manager updates any lesson"
ON public.lessons FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'))
WITH CHECK (public.has_role(auth.uid(), 'manager'));

-- Тутор оновлює свої уроки, але НЕ може міняти фінанси
CREATE POLICY "Tutor updates own lessons (non-financial)"
ON public.lessons FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'tutor')
  AND auth.uid() = tutor_id
)
WITH CHECK (
  public.has_role(auth.uid(), 'tutor')
  AND auth.uid() = tutor_id
);

-- DELETE
CREATE POLICY "Manager deletes any lesson"
ON public.lessons FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'manager'));

CREATE POLICY "Tutor deletes own pending/scheduled lessons"
ON public.lessons FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'tutor')
  AND auth.uid() = tutor_id
  AND status IN ('pending', 'scheduled')
);

-- ============================================
-- TRIGGER: захист фінансових полів від туторів і учнів
-- ============================================
CREATE OR REPLACE FUNCTION public.protect_lesson_financials()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Менеджер може все
  IF public.has_role(auth.uid(), 'manager') THEN
    RETURN NEW;
  END IF;

  -- Не-менеджер не може змінювати фінансові поля
  IF NEW.student_price IS DISTINCT FROM OLD.student_price
     OR NEW.tutor_payout IS DISTINCT FROM OLD.tutor_payout
     OR NEW.student_payment_status IS DISTINCT FROM OLD.student_payment_status
     OR NEW.tutor_payout_status IS DISTINCT FROM OLD.tutor_payout_status
     OR NEW.student_paid_at IS DISTINCT FROM OLD.student_paid_at
     OR NEW.tutor_paid_at IS DISTINCT FROM OLD.tutor_paid_at
     OR NEW.tutor_id IS DISTINCT FROM OLD.tutor_id
     OR NEW.student_id IS DISTINCT FROM OLD.student_id
  THEN
    RAISE EXCEPTION 'Тільки менеджер може змінювати фінансові поля та учасників уроку';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lessons_protect_financials
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.protect_lesson_financials();

-- ============================================
-- TRIGGER: автозаповнення цін при створенні
-- ============================================
CREATE OR REPLACE FUNCTION public.autofill_lesson_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rate NUMERIC(10,2);
  _payout NUMERIC(10,2);
BEGIN
  -- Якщо ціна для учня = 0, спробувати взяти з student_rates
  IF NEW.student_price = 0 THEN
    SELECT price_per_lesson INTO _rate
    FROM public.student_rates
    WHERE tutor_id = NEW.tutor_id AND student_id = NEW.student_id;
    IF _rate IS NOT NULL THEN
      NEW.student_price := _rate;
    END IF;
  END IF;

  -- Якщо виплата = 0, взяти ставку тутора
  IF NEW.tutor_payout = 0 THEN
    SELECT rate_per_lesson INTO _payout
    FROM public.tutor_details
    WHERE user_id = NEW.tutor_id;
    IF _payout IS NOT NULL THEN
      NEW.tutor_payout := _payout;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lessons_autofill_prices
BEFORE INSERT ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.autofill_lesson_prices();

-- ============================================
-- TRIGGER: автоматично ставити дату оплати при зміні статусу
-- ============================================
CREATE OR REPLACE FUNCTION public.set_payment_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.student_payment_status = 'paid' AND (OLD.student_payment_status IS DISTINCT FROM 'paid') THEN
    NEW.student_paid_at := COALESCE(NEW.student_paid_at, now());
  ELSIF NEW.student_payment_status = 'unpaid' THEN
    NEW.student_paid_at := NULL;
  END IF;

  IF NEW.tutor_payout_status = 'paid' AND (OLD.tutor_payout_status IS DISTINCT FROM 'paid') THEN
    NEW.tutor_paid_at := COALESCE(NEW.tutor_paid_at, now());
  ELSIF NEW.tutor_payout_status = 'unpaid' THEN
    NEW.tutor_paid_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lessons_payment_dates
BEFORE UPDATE ON public.lessons
FOR EACH ROW EXECUTE FUNCTION public.set_payment_dates();
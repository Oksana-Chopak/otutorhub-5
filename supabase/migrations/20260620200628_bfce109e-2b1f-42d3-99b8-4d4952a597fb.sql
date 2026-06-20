CREATE OR REPLACE FUNCTION public.tsp_lessons_ins() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.student_id IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.tutor_student_pairs (tutor_id, student_id, from_lessons)
  VALUES (NEW.tutor_id, NEW.student_id, 1)
  ON CONFLICT (tutor_id, student_id) DO UPDATE SET from_lessons = public.tutor_student_pairs.from_lessons + 1;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.tsp_lessons_del() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF OLD.student_id IS NULL THEN RETURN OLD; END IF;
  UPDATE public.tutor_student_pairs
     SET from_lessons = GREATEST(from_lessons - 1, 0)
   WHERE tutor_id = OLD.tutor_id AND student_id = OLD.student_id;
  DELETE FROM public.tutor_student_pairs
   WHERE tutor_id = OLD.tutor_id AND student_id = OLD.student_id
     AND from_lessons = 0 AND COALESCE(from_rates, 0) = 0;
  RETURN OLD;
END $$;
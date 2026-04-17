-- Замінюємо широку SELECT-політику на вужчу: дозволяємо тільки автентифікованим читати,
-- а анонімне читання прибираємо (URL з підписом не потрібен — ми використовуємо getPublicUrl, але обмежимо листинг через role-based access).
DROP POLICY IF EXISTS "Avatars publicly readable" ON storage.objects;

-- Робимо bucket приватним щоб уникнути листингу
UPDATE storage.buckets SET public = false WHERE id = 'avatars';

-- Дозволяємо всім автентифікованим читати аватари (для відображення в UI)
CREATE POLICY "Authenticated read avatars" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

/**
 * B8: тримає profiles.preferred_language = поточній мові інтерфейсу,
 * щоб серверні сповіщення (payment-reminders тощо) говорили мовою людини.
 * Пише лише при зміні (кеш у localStorage) — нуль зайвих запитів.
 */
export function useSyncLanguage() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  useEffect(() => {
    if (!user) return;
    const lang = (i18n.language || "uk").slice(0, 2);
    const norm = lang === "en" || lang === "sv" ? lang : "uk";
    const key = `lang_synced:${user.id}`;
    if (localStorage.getItem(key) === norm) return;
    void (supabase.from("profiles") as any)
      .update({ preferred_language: norm })
      .eq("id", user.id)
      .then(() => localStorage.setItem(key, norm));
  }, [user, i18n.language]);
}

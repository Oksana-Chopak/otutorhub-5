import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";

/**
 * B8: тримає profiles.preferred_language = мові людини, щоб серверні
 * сповіщення (payment-reminders, вечірній підсумок) говорили її мовою.
 *
 * Аудит 05.09: хук ПИСАВ мову, ніколи її не читаючи — відкриття застосунку
 * з нового пристрою (де інтерфейс стартує з дефолтної) мовчки перемикало
 * серверні нагадування на українську. Це болітиме на Швеції. Тепер:
 * на пристрої, що ще не синхронізувався, СПЕРШУ читаємо збережену мову і
 * застосовуємо її до інтерфейсу; пишемо лише коли людина справді змінила
 * мову ПІСЛЯ звірки (або коли на сервері мови ще немає).
 */
const norm = (l: string | null | undefined): "uk" | "en" | "sv" => {
  const s = (l || "uk").slice(0, 2);
  return s === "en" || s === "sv" ? s : "uk";
};

export function useSyncLanguage() {
  const { user } = useAuth();
  const { i18n } = useTranslation();
  useEffect(() => {
    if (!user) return;
    const key = `lang_synced:${user.id}`;
    const current = norm(i18n.language);
    const seen = localStorage.getItem(key);

    if (!seen) {
      // Новий пристрій: сервер — джерело правди, поки людина не обрала сама.
      void supabase
        .from("profiles")
        .select("preferred_language")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data, error }) => {
          if (error) return; // не прочитали — нічого й не затираємо
          // Якщо людина ВЖЕ перемкнула мову, поки летіло читання, — її вибір головніший.
          const uiNow = norm(i18n.language);
          if (uiNow !== current) return;
          const server = data?.preferred_language ? norm(data.preferred_language) : null;
          if (server) {
            localStorage.setItem(key, server);
            if (server !== uiNow) void i18n.changeLanguage(server);
          } else {
            void (supabase.from("profiles") as any)
              .update({ preferred_language: uiNow })
              .eq("id", user.id)
              .then(() => localStorage.setItem(key, uiNow));
          }
        });
      return;
    }

    if (seen === current) return;
    void (supabase.from("profiles") as any)
      .update({ preferred_language: current })
      .eq("id", user.id)
      .then(() => localStorage.setItem(key, current));
  }, [user, i18n.language]);
}

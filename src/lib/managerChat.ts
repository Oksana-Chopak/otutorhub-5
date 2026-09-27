import { supabase } from "@/integrations/supabase/client";

/**
 * Чат із менеджером школи — ОДИН канон.
 *
 * `start_manager_chat()` (SECURITY DEFINER, EXECUTE у `authenticated`) сама
 * знаходить школу того, хто кличе, її менеджера і за потреби створює тред.
 * Аргументів не бере — тобто «перший менеджер платформи» тут неможливий за
 * побудовою, школа рахується від людини.
 *
 * Чому окремий модуль: до 27.09 виклик жив інлайном у `DashboardPage`
 * (кнопка «Менеджер хабу» хабового репетитора). Учню теж потрібен цей шлях
 * (§4 аудиту шляхів: «Заявка в роботі» — статус без жодної дії, ні чату з
 * менеджером), а друга копія виклику + навігації розʼїхалась би з першою.
 */
export async function startManagerChat(): Promise<string | null> {
  const { data, error } = await (supabase as any).rpc("start_manager_chat");
  if (error || !data) return null;
  return data as string;
}

/** Адреса треду: ChatsPage сама відкриває його за `?with=`. */
export const managerChatPath = (managerId: string) => `/chats?with=${managerId}`;

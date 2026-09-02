import { useAuth } from "@/hooks/useAuth";
import { useWorkspaceSettings } from "@/hooks/useWorkspaceSettings";
import type { RoleFlags } from "@/lib/roleCapabilities";

/**
 * Єдине місце, де ролі + налаштування воркспейсу перетворюються на RoleFlags
 * для `canSee(...)`. Сторінка більше не тримає сирий `isIndependent` — вона
 * питає «чи бачить ця роль цю фічу», а матриця ролей відповідає.
 *
 * `ready` — прапорець «персона вже відома». Поки він false, персона ще
 * вантажиться, і будь-який рендер за прапорцями показує ХИБНУ роль: до
 * відповіді сервера `isIndependent` дефолтиться в false, тобто кожен
 * незалежний репетитор на частку секунди виглядає як хабовий (гонка персон,
 * аудит 01.09).
 */
export function useRoleFlags(): { flags: RoleFlags; ready: boolean } {
  const { roles } = useAuth();
  const ws = useWorkspaceSettings();
  return {
    flags: {
      isManager: roles.includes("manager"),
      isTutor: roles.includes("tutor"),
      isIndependent: ws.isIndependent,
      isStudent: roles.includes("student"),
    },
    ready: ws.roleReady,
  };
}

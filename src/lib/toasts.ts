/**
 * toasts.ts
 *
 * Централізовані toast-повідомлення з контекстом і емоційним підкріпленням.
 *
 * Замість:   toast.success("Учня додано")
 * Пишемо:    appToast.studentAdded("Марія Петренко")
 *
 * Замість:   toast.error("Не вдалося оновити")
 * Пишемо:    appToast.updateFailed("оплату")
 */

import { toast } from "sonner";

// ─── Типи ────────────────────────────────────────────────────────────────────

interface ToastOptions {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function success(title: string, opts?: ToastOptions) {
  toast.success(title, {
    duration: opts?.duration ?? 4000,
    description: opts?.description,
    action: opts?.action,
  });
}

function error(title: string, opts?: ToastOptions) {
  toast.error(title, {
    duration: opts?.duration ?? 5000,
    description: opts?.description ?? "Спробуйте ще раз або оновіть сторінку.",
    action: opts?.action,
  });
}

function info(title: string, opts?: ToastOptions) {
  toast.info(title, {
    duration: opts?.duration ?? 4000,
    description: opts?.description,
  });
}

// ─── Students ────────────────────────────────────────────────────────────────

export const studentToasts = {
  added: (name: string) =>
    success(`✓ ${name} додано`, {
      description: "Тепер можна запланувати перший урок.",
      action: { label: "Створити урок", onClick: () => window.location.assign("/schedule") },
    }),

  invited: (name: string) =>
    success(`Запрошення надіслано`, {
      description: `${name} отримає email із посиланням для входу.`,
    }),

  updated: (name: string) =>
    success(`Дані збережено`, {
      description: `Профіль ${name} оновлено.`,
    }),

  archived: (name: string) =>
    info(`${name} переміщено в архів`, {
      description: "Можна відновити будь-коли через фільтр «Архів».",
    }),

  restored: (name: string) =>
    success(`${name} повернено`, {
      description: "Учень знову активний.",
    }),

  addFailed: () =>
    error("Не вдалося додати учня", {
      description: "Перевірте з'єднання і спробуйте ще раз.",
    }),

  updateFailed: () =>
    error("Не вдалося зберегти зміни"),
};

// ─── Lessons ─────────────────────────────────────────────────────────────────

export const lessonToasts = {
  created: (studentName: string, date: string) =>
    success(`Урок створено`, {
      description: `${studentName} · ${date}`,
      action: { label: "До розкладу", onClick: () => window.location.assign("/schedule") },
    }),

  statusUpdated: (newStatus: "completed" | "cancelled" | "scheduled") => {
    const messages = {
      completed: { title: "✓ Урок проведено", description: "Статус оновлено." },
      cancelled: { title: "Урок скасовано", description: "Статус оновлено." },
      scheduled: { title: "Урок заплановано", description: "Статус оновлено." },
    };
    const { title, description } = messages[newStatus];
    success(title, { description });
  },

  paymentMarked: (who: "student" | "tutor", amount?: string) => {
    const label = who === "student" ? "Оплата від учня" : "Виплата репетитору";
    success(`✓ ${label} зафіксована`, {
      description: amount ? `Сума: ${amount}` : undefined,
    });
  },

  deleted: () =>
    info("Урок видалено", {
      description: "Дія незворотна.",
    }),

  createFailed: () =>
    error("Не вдалося створити урок"),

  updateFailed: () =>
    error("Не вдалося оновити урок"),

  deleteFailed: () =>
    error("Не вдалося видалити урок"),
};

// ─── Payments ────────────────────────────────────────────────────────────────

export const paymentToasts = {
  updated: () =>
    success("Оплату оновлено"),

  failed: () =>
    error("Не вдалося оновити оплату"),
};

// ─── Profile / Settings ───────────────────────────────────────────────────────

export const profileToasts = {
  saved: () =>
    success("Профіль збережено", {
      description: "Зміни застосовано.",
    }),

  failed: () =>
    error("Не вдалося зберегти профіль"),

  avatarUploaded: () =>
    success("Аватар оновлено ✓"),
};

// ─── Generic ─────────────────────────────────────────────────────────────────

export const appToast = {
  loadError: () =>
    error("Не вдалося завантажити дані", {
      description: "Перевірте з'єднання або оновіть сторінку.",
      action: { label: "Оновити", onClick: () => window.location.reload() },
    }),

  saved: () => success("Збережено ✓"),
  saveFailed: () => error("Не вдалося зберегти"),
  copied: (what = "Скопійовано") => toast(what, { duration: 2000 }),
};

// ─── Re-export raw toast for cases not covered above ─────────────────────────
export { toast };

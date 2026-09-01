import { useEffect, useState } from 'react';
import { confirmDialog } from '@/hooks/useConfirm';
import { subscribePending, subscribeFailed, retryFailed, discardFailed } from '@/lib/offlineQueue';
import { WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Offline state banner — shows when user loses internet connection.
 * Appears at top of screen, auto-hides when connection restored.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(!navigator.onLine);
  const [justRestored, setJustRestored] = useState(false);
  // D (офлайн): скільки змін чекає мережі — щоб банер казав правду, а не лише «немає інтернету»
  const [pending, setPending] = useState(0);
  useEffect(() => subscribePending(setPending), []);
  // Хвіст B12: відхилені сервером записи більше не зникають мовчки —
  // вони видимі й мають кнопку «спробувати ще».
  const [failed, setFailed] = useState(0);
  useEffect(() => subscribeFailed(setFailed), []);

  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      setJustRestored(true);
      setTimeout(() => setJustRestored(false), 3000);
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  if (failed > 0) {
    return (
      <div role="status" className="fixed left-0 right-0 top-0 z-[200] flex flex-wrap items-center justify-center gap-2 bg-[#b45309] px-4 py-2 text-[14px] font-medium text-white shadow-lg" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}>
        {t('offline.failedPending', { count: failed })}
        <button type="button" onClick={() => void retryFailed()} className="tap-44 rounded-full bg-white/20 px-3 py-1 font-bold">
          {t('offline.retry')}
        </button>
        <button
          type="button"
          onClick={async () => {
            // Аудит 01.09: тут лежать НЕнадіслані оплати й повідомлення —
            // стирати їх мовчки не можна, тим паче що кнопка стоїть впритул
            // до «Спробувати ще».
            if (await confirmDialog({
              description: t('offline.discardConfirm', { count: failed }),
              confirmText: t('offline.discard'),
              destructive: true,
            })) discardFailed();
          }}
          className="tap-44 rounded-full px-3 py-1 underline"
        >
          {t('offline.discard')}
        </button>
      </div>
    );
  }

  if (!offline && !justRestored) return null;

  if (justRestored) {
    return (
      <div className="fixed left-0 right-0 top-0 z-[200] flex items-center justify-center gap-2 bg-green-500 px-4 py-2 text-[14px] font-medium text-white shadow-lg transition-all animate-in slide-in-from-top" style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}>
        ✅ {t('offline.restored')}
      </div>
    );
  }

  return (
    <div className="fixed left-0 right-0 top-0 z-[200] flex items-center justify-center gap-2 bg-[#0f0f1a] px-4 py-2.5 text-[14px] font-medium text-white shadow-lg animate-in slide-in-from-top" style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top, 0px))" }}>
      <WifiOff className="h-4 w-4 text-yellow-400" />
      {pending > 0
        ? t('offline.pendingQueued', { count: pending })
        : t('offline.noConnection')}
    </div>
  );
}

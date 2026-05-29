import { useEffect, useState } from 'react';
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

  if (!offline && !justRestored) return null;

  if (justRestored) {
    return (
      <div className="fixed left-0 right-0 top-0 z-[200] flex items-center justify-center gap-2 bg-green-500 px-4 py-2 text-[13px] font-medium text-white shadow-lg transition-all animate-in slide-in-from-top">
        ✅ {t('offline.restored') || 'Зʼєднання відновлено'}
      </div>
    );
  }

  return (
    <div className="fixed left-0 right-0 top-0 z-[200] flex items-center justify-center gap-2 bg-[#0f0f1a] px-4 py-2.5 text-[13px] font-medium text-white shadow-lg animate-in slide-in-from-top">
      <WifiOff className="h-4 w-4 text-yellow-400" />
      {t('offline.noConnection') || 'Немає зʼєднання — перевір інтернет'}
    </div>
  );
}

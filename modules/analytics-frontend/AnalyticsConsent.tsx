'use client';

import { useEffect } from 'react';

const STORAGE_KEY = 'tk-cookie-consent';

/**
 * Ставит атрибут `data-cc="accepted"` на <html>, если пользователь принял cookies.
 * Триггерит «соседние» init-скрипты GA/YM в Analytics.tsx, которые этот атрибут читают.
 */
export default function AnalyticsConsent() {
  useEffect(() => {
    const apply = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw) as { status?: string };
        if (data?.status === 'accepted') {
          document.documentElement.setAttribute('data-cc', 'accepted');
        }
      } catch { /* ignore */ }
    };
    apply();
    window.addEventListener('cookie-consent-accepted', apply);
    return () => window.removeEventListener('cookie-consent-accepted', apply);
  }, []);
  return null;
}

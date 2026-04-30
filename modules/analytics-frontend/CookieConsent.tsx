'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'tk-cookie-consent';

interface ConsentState {
  status: 'accepted' | 'declined';
  ts: string;
}

interface CookieConsentProps {
  locale: string;
}

/**
 * Cookie-consent banner. На desktop — карточка справа-внизу.
 * На mobile — однострочная плашка снизу с шириной всего экрана и кнопкой
 * «Қабылдау» (компактно), расширение по тапу. Не перекрывает hero/CTA.
 *
 * GA4 / Yandex.Metrica загружаются только при `data-cc="accepted"` — см.
 * AnalyticsConsent + Analytics. Без согласия трекеры не грузятся (ЗРК
 * «О персональных данных»).
 */
export default function CookieConsent({ locale }: CookieConsentProps) {
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // Ленивая инициализация без setState в effect: читаем localStorage
    // и обновляем состояние ровно один раз.
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(STORAGE_KEY);
    } catch { /* ignore */ }
    if (!raw) setShow(true);
  }, []);

  const set = (status: 'accepted' | 'declined') => {
    const payload: ConsentState = { status, ts: new Date().toISOString() };
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch { /* ignore */ }
    setShow(false);
    if (status === 'accepted') {
      window.dispatchEvent(new Event('cookie-consent-accepted'));
    }
  };

  if (!show) return null;

  const t = (kk: string, ru: string) => (locale === 'kk' ? kk : ru);

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 px-3 pb-3 sm:left-auto sm:bottom-4 sm:right-4 sm:max-w-md sm:px-0 sm:pb-0"
      role="dialog"
      aria-live="polite"
    >
      {/* Mobile compact: одна строка, минимум места. Desktop / expanded: полная карточка. */}
      <div className={`rounded-2xl border border-gray-200 bg-white shadow-2xl ${expanded ? 'p-4' : 'p-3'} sm:p-5`}>
        {expanded ? (
          // Полная версия — desktop всегда, mobile после клика.
          <>
            <p className="text-sm text-gray-700">
              🍪 {t(
                'Біз cookie мен аналитика (GA4, Яндекс.Метрика) қолданамыз. Сіз қабылдаған соң ғана іске қосылады.',
                'Мы используем cookies и аналитику (GA4, Яндекс.Метрика). Они активируются только после вашего согласия.',
              )}
            </p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button
                onClick={() => set('accepted')}
                className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 min-h-[40px]"
              >
                {t('Қабылдау', 'Принять')}
              </button>
              <button
                onClick={() => set('declined')}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50 min-h-[40px]"
              >
                {t('Бас тарту', 'Отклонить')}
              </button>
              <a
                href={`/${locale}/privacy`}
                className="px-3 py-2 text-sm text-teal-700 hover:underline self-center min-h-[40px] flex items-center"
              >
                {t('Құпиялылық', 'Политика')}
              </a>
            </div>
          </>
        ) : (
          // Компактная mobile-плашка: текст + «Принять» + «…» (раскрыть).
          // На desktop — рендерится full (`sm:hidden` скрывает компакт).
          <div className="sm:hidden flex items-center gap-2">
            <span className="flex-1 text-xs text-gray-700 truncate">
              🍪 {t('Cookie & аналитика', 'Cookies и аналитика')}
            </span>
            <button
              onClick={() => set('accepted')}
              className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium min-h-[36px]"
            >
              {t('Қабылдау', 'OK')}
            </button>
            <button
              onClick={() => setExpanded(true)}
              aria-label={t('Толығырақ', 'Подробнее')}
              className="w-9 h-9 rounded-lg border border-gray-300 text-gray-600 flex items-center justify-center"
            >
              ⋯
            </button>
          </div>
        )}

        {/* Desktop всегда показывает full-версию */}
        {!expanded && (
          <div className="hidden sm:block">
            <p className="text-sm text-gray-700">
              🍪 {t(
                'Біз cookie мен аналитика (GA4, Яндекс.Метрика) қолданамыз. Сіз қабылдаған соң ғана іске қосылады.',
                'Мы используем cookies и аналитику (GA4, Яндекс.Метрика). Они активируются только после вашего согласия.',
              )}
            </p>
            <div className="mt-3 flex gap-2 flex-wrap">
              <button
                onClick={() => set('accepted')}
                className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700"
              >
                {t('Қабылдау', 'Принять')}
              </button>
              <button
                onClick={() => set('declined')}
                className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm hover:bg-gray-50"
              >
                {t('Бас тарту', 'Отклонить')}
              </button>
              <a
                href={`/${locale}/privacy`}
                className="px-4 py-2 text-sm text-teal-700 hover:underline self-center"
              >
                {t('Құпиялылық саясаты', 'Политика конфиденциальности')}
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

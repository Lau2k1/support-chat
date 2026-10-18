import { useEffect, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { authApi } from '@/services/endpoints';
import type { TelegramWidgetData } from '@/types';

interface Props {
  onAuth: (user: TelegramWidgetData) => void;
  /** Виджет недоступен: Telegram не настроен или скрипт не загрузился. */
  onUnavailable?: () => void;
  /** Окно Telegram закрыли, не завершив вход: виджет прислал 'unauthorized'. */
  onUnauthorized?: () => void;
  disabled?: boolean;
}

/**
 * Renders the official Telegram Login Widget.
 *
 * The script is injected WITHOUT data-onauth: that attribute makes the widget
 * eval() the callback expression, and the CSP (script-src without
 * 'unsafe-eval', SEC-01) blocks eval — the widget then crashes before creating
 * its iframe and no button appears. Instead, the signed payload is delivered
 * to the page as a postMessage ('auth_user') from oauth.telegram.org, which we
 * listen for ourselves and forward to onAuth; the server re-verifies the
 * signature with the bot token either way.
 *
 * Renders nothing when Telegram login is not configured, so the panel degrades
 * gracefully before the bot token is in place.
 */
export default function TelegramLoginButton({
  onAuth,
  onUnavailable,
  onUnauthorized,
  disabled = false,
}: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const botUsername = useRef<string | null>(null);
  const callback = useRef(onAuth);
  const unavailable = useRef(onUnavailable);
  const unauthorized = useRef(onUnauthorized);
  const [ready, setReady] = useState(false);

  // Keep the latest callbacks without re-injecting the widget script.
  useEffect(() => {
    callback.current = onAuth;
    unavailable.current = onUnavailable;
    unauthorized.current = onUnauthorized;
  }, [onAuth, onUnavailable, onUnauthorized]);

  useEffect(() => {
    let cancelled = false;
    authApi
      .telegramConfig()
      .then((res) => {
        if (cancelled) return;
        botUsername.current = res.data.enabled ? res.data.botUsername : null;
        setReady(Boolean(botUsername.current));
        if (!botUsername.current) unavailable.current?.();
      })
      .catch(() => {
        if (cancelled) return;
        setReady(false);
        unavailable.current?.();
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://oauth.telegram.org') return;
      let data: { event?: string; auth_data?: TelegramWidgetData };
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (data.event === 'auth_user' && data.auth_data) {
        callback.current(data.auth_data);
        return;
      }
      // Окно Telegram закрыли, не завершив вход: раньше это выглядело как
      // «кнопка ничего не делает», теперь показываем сообщение.
      if (data.event === 'unauthorized') unauthorized.current?.();
    };
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
    };
  }, [ready]);

  useEffect(() => {
    const el = holder.current;
    if (!ready || !botUsername.current || !el) return;

    el.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername.current);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-request-access', 'write');
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [ready]);

  if (!ready) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.75,
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    >
      <Box ref={holder} />
      <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
        Откроется окно Telegram — подтвердите вход
      </Typography>
    </Box>
  );
}

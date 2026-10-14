import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { authApi } from '@/services/endpoints';
import type { TelegramWidgetData } from '@/types';

declare global {
  interface Window {
    /** Called by telegram-widget.js (data-onauth) — must be global. */
    onTelegramAuth?: (user: TelegramWidgetData) => void;
  }
}

interface Props {
  onAuth: (user: TelegramWidgetData) => void;
  disabled?: boolean;
}

/**
 * Renders the official Telegram Login Widget.
 *
 * The widget hands the signed user payload to a global callback
 * (`data-onauth="onTelegramAuth(user)"`) instead of posting it somewhere itself —
 * our server then re-verifies the signature with the bot token.
 *
 * Renders nothing when Telegram login is not configured, so the panel degrades
 * gracefully before the bot token is in place.
 */
export default function TelegramLoginButton({ onAuth, disabled = false }: Props) {
  const holder = useRef<HTMLDivElement | null>(null);
  const botUsername = useRef<string | null>(null);
  const callback = useRef(onAuth);
  const [ready, setReady] = useState(false);

  // Keep the latest callback without re-injecting the widget script.
  useEffect(() => {
    callback.current = onAuth;
  }, [onAuth]);

  useEffect(() => {
    let cancelled = false;
    authApi
      .telegramConfig()
      .then((res) => {
        if (cancelled) return;
        botUsername.current = res.data.enabled ? res.data.botUsername : null;
        setReady(Boolean(botUsername.current));
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = holder.current;
    if (!ready || !botUsername.current || !el) return;

    window.onTelegramAuth = (user: TelegramWidgetData) => callback.current(user);

    el.innerHTML = '';
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', botUsername.current);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-onauth', 'onTelegramAuth(user)');
    script.setAttribute('data-request-access', 'write');
    el.appendChild(script);

    return () => {
      el.innerHTML = '';
    };
  }, [ready]);

  if (!ready) return null;

  return (
    <Box
      ref={holder}
      sx={{
        display: 'flex',
        justifyContent: 'center',
        opacity: disabled ? 0.6 : 1,
        pointerEvents: disabled ? 'none' : 'auto',
      }}
    />
  );
}

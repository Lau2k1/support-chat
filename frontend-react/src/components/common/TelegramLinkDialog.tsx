import { useCallback, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';
import TelegramIcon from '@mui/icons-material/Telegram';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import TelegramLoginButton from './TelegramLoginButton';
import type { TelegramWidgetData } from '@/types';

/**
 * "Привязать Telegram" dialog for administrators.
 *
 * Linking uses the same Login Widget as sign-in, but the payload is sent to
 * /me/telegram/link so it attaches to the *current* account instead of logging
 * someone in. Unlinking is refused by the server when the account has no
 * password (otherwise the admin would lock themselves out).
 */
export default function TelegramLinkDialog() {
  const open = useUIStore((s) => s.telegramOpen);
  const hide = useUIStore((s) => s.hideTelegram);
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const user = useAuthStore((s) => s.user);
  const refresh = useAuthStore((s) => s.refresh);
  const [busy, setBusy] = useState(false);

  const linked = user?.telegram?.linked ?? false;
  const username = user?.telegram?.username ?? null;

  const handleAuth = useCallback(
    async (data: TelegramWidgetData) => {
      setBusy(true);
      try {
        const res = await authApi.linkTelegram(data);
        await refresh();
        showToast(
          res.data.telegram.username
            ? `Telegram привязан: @${res.data.telegram.username}`
            : 'Telegram привязан'
        );
        hide();
      } catch (e: any) {
        showToast(e?.response?.data?.error || 'Не удалось привязать Telegram', 'error');
      } finally {
        setBusy(false);
      }
    },
    [refresh, showToast, hide]
  );

  const handleUnlink = () => {
    showConfirm({
      text: 'Отвязать Telegram от аккаунта? Вход через Telegram перестанет работать.',
      confirmLabel: 'Отвязать',
      danger: true,
      onConfirm: async () => {
        setBusy(true);
        try {
          await authApi.unlinkTelegram();
          await refresh();
          showToast('Telegram отвязан');
          hide();
        } catch (e: any) {
          showToast(e?.response?.data?.error || 'Не удалось отвязать Telegram', 'error');
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <Dialog open={open} onClose={hide} fullWidth maxWidth="xs">
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <TelegramIcon sx={{ color: '#229ED9' }} />
        Telegram
      </DialogTitle>
      <DialogContent dividers>
        {linked ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip label="Привязан" color="success" size="small" />
              {username && (
                <Typography variant="body2" color="text.secondary">
                  @{username}
                </Typography>
              )}
            </Box>
            <Alert severity="info" icon={false}>
              Теперь вы можете входить в панель кнопкой «Войти через Telegram» — пароль при этом не нужен.
            </Alert>
            <Divider />
            <Typography variant="caption" color="text.secondary">
              Отвязка доступна, только если у аккаунта задан пароль.
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, py: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Привяжите свой Telegram, чтобы входить в панель одним нажатием — без ввода почты и пароля.
            </Typography>
            <TelegramLoginButton
              onAuth={handleAuth}
              onUnauthorized={() =>
                showToast('Вход через Telegram не завершён — попробуйте ещё раз', 'error')
              }
              disabled={busy}
            />
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              Данные подтверждает Telegram — пароль мы не увидим.
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={hide} disabled={busy}>
          Закрыть
        </Button>
        {linked && (
          <Button color="error" onClick={handleUnlink} disabled={busy}>
            Отвязать
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

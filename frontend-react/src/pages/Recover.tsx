import { useCallback, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Card, Divider, Link, TextField, Typography } from '@mui/material';
import { useColorScheme } from '@mui/material/styles';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { validatePassword } from '@/utils/validation';
import TelegramLoginButton from '@/components/common/TelegramLoginButton';
import ThemeToggle from '@/components/common/ThemeToggle';
import type { TelegramRecoveryStart, TelegramWidgetData } from '@/types';

/** Аккаунты без привязанного Telegram владелец восстанавливает вручную. */
const SUPPORT_URL = 'https://t.me/sctManager';

/**
 * Восстановление пароля через Telegram: шаг 1 подтверждает личность тем же
 * виджетом, что и вход, шаг 2 задаёт новый пароль по одноразовому токену.
 * Почтовой рассылки на платформе нет, поэтому другого канала восстановления нет.
 */
export default function Recover() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [reset, setReset] = useState<TelegramRecoveryStart | null>(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** Виджет Telegram не отдался — тогда подтвердить личность нечем. */
  const [widgetUnavailable, setWidgetUnavailable] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleTelegram = useCallback(async (data: TelegramWidgetData) => {
    setError('');
    setLoading(true);
    try {
      const res = await authApi.telegramRecoveryStart(data);
      setReset(res.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Не удалось подтвердить Telegram');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!reset) return;
    const passErr = validatePassword(password);
    if (passErr) {
      setError(passErr);
      return;
    }
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      await authApi.telegramRecoveryConfirm(reset.token, password);
      await login();
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Не удалось изменить пароль. Начните заново.');
    } finally {
      setLoading(false);
    }
  };

  const restart = () => {
    setReset(null);
    setPassword('');
    setPassword2('');
    setError('');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        backgroundImage: isDark
          ? 'radial-gradient(circle at 50% 0%, rgba(77,158,255,0.14) 0%, transparent 55%)'
          : 'radial-gradient(circle at 50% 0%, rgba(0,123,255,0.10) 0%, transparent 55%)',
      }}
    >
      <Box sx={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </Box>
      <Card
        sx={{
          p: 5,
          width: 360,
          borderRadius: 3,
          boxShadow: isDark ? '0 20px 60px rgba(0,0,0,0.55)' : '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 3.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Support
            <Box component="span" sx={{ color: 'primary.main' }}>
              Chat
            </Box>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Восстановление пароля
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!reset ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Подтвердите личность через Telegram — после этого можно сразу задать новый пароль.
              Подойдёт тот Telegram, который привязан к аккаунту.
            </Typography>

            <TelegramLoginButton
              onAuth={handleTelegram}
              onUnavailable={() => setWidgetUnavailable(true)}
              disabled={loading}
            />

            {loading && (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                Проверяем Telegram...
              </Typography>
            )}

            {widgetUnavailable && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Вход через Telegram сейчас недоступен. Напишите в поддержку:{' '}
                <Link href={SUPPORT_URL} target="_blank" rel="noopener" underline="hover">
                  @sctManager
                </Link>
                .
              </Alert>
            )}
          </>
        ) : (
          <Box component="form" onSubmit={handleSubmit}>
            <Alert severity="success" sx={{ mb: 2 }}>
              Telegram подтверждён
            </Alert>
            <Typography variant="body2" sx={{ mb: 0.5 }}>
              Аккаунт: <b>{reset.name}</b>
            </Typography>
            {reset.email && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {reset.email}
              </Typography>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Задайте новый пароль. Все остальные сессии аккаунта выйдут из системы. Ссылка
              действует {reset.ttlMinutes} минут.
            </Typography>

            <TextField
              fullWidth
              label="Новый пароль"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              sx={{ mb: 1.5 }}
              required
              autoFocus
            />
            <TextField
              fullWidth
              label="Повторите новый пароль"
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              sx={{ mb: 2 }}
              required
            />
            <Button
              fullWidth
              type="submit"
              variant="contained"
              disabled={loading}
              sx={{ py: 1.5, fontWeight: 600 }}
            >
              {loading ? 'Сохраняем...' : 'Изменить пароль'}
            </Button>
            <Button fullWidth onClick={restart} disabled={loading} sx={{ mt: 1 }}>
              Не тот аккаунт — начать заново
            </Button>
          </Box>
        )}

        <Divider sx={{ my: 2.5 }}>
          <Typography variant="caption" color="text.secondary">
            нужна помощь
          </Typography>
        </Divider>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
          Если Telegram не привязан к аккаунту или потерян, напишите{' '}
          <Link href={SUPPORT_URL} target="_blank" rel="noopener" underline="hover">
            @sctManager
          </Link>{' '}
          — восстановим доступ вручную.
        </Typography>

        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Link component={RouterLink} to="/login" variant="body2" sx={{ fontWeight: 600 }}>
            Вернуться ко входу
          </Link>
        </Box>
      </Card>
    </Box>
  );
}

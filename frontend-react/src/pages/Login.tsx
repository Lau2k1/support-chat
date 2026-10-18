import { useCallback, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  FormControlLabel,
  Checkbox,
  Divider,
} from '@mui/material';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { validateEmail } from '@/utils/validation';
import TelegramLoginButton from '@/components/common/TelegramLoginButton';
import ThemeToggle from '@/components/common/ThemeToggle';
import { useColorScheme } from '@mui/material/styles';
import type { TelegramWidgetData } from '@/types';

export default function Login() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [email, setEmail] = useState(() => localStorage.getItem('sc_remember_email') || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('sc_remember') === '1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  /** Sign in (or self-register) with the payload verified by our backend. */
  const handleTelegram = useCallback(
    async (data: TelegramWidgetData) => {
      setError('');
      setLoading(true);
      try {
        const res = await authApi.telegramLogin(data);
        await login();
        if (res.data.registered) {
          // Fresh client: the account exists but the tenant is unpaid.
          navigate('/admin');
        } else {
          navigate('/');
        }
      } catch (err: any) {
        setError(err.response?.data?.error || 'Не удалось войти через Telegram');
      } finally {
        setLoading(false);
      }
    },
    [login, navigate]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const emailErr = validateEmail(email);
    if (emailErr) { setError(emailErr); return; }
    if (!password) { setError('Введите пароль'); return; }

    setLoading(true);
    try {
      const em = email.trim().toLowerCase();
      await authApi.login(em, password);
      if (remember) {
        localStorage.setItem('sc_remember', '1');
        localStorage.setItem('sc_remember_email', em);
      } else {
        localStorage.removeItem('sc_remember');
        localStorage.removeItem('sc_remember_email');
      }
      await login();
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка входа. Попробуйте ещё раз');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        bgcolor: 'background.default',
        // A soft primary halo instead of a light-only gradient: the scheme picks
        // the tint, so the page stays coherent in dark mode.
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
            Платформа поддержки
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            fullWidth
            label="Пароль"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            sx={{ mb: 1.5 }}
            required
          />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
            <FormControlLabel
              control={<Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
              label="Запомнить меня"
              sx={{ mr: 0 }}
            />
            <Link component={RouterLink} to="/recover" variant="body2">
              Забыли пароль?
            </Link>
          </Box>
          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ py: 1.5, fontWeight: 600 }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </Button>
        </Box>

        <Divider sx={{ my: 2.5 }}>
          <Typography variant="caption" color="text.secondary">
            или
          </Typography>
        </Divider>

        <TelegramLoginButton onAuth={handleTelegram} disabled={loading} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          Продолжая, вы принимаете{' '}
          <Link href="/legal/offer" target="_blank" rel="noopener" underline="hover">
            оферту
          </Link>{' '}
          и{' '}
          <Link href="/legal/privacy" target="_blank" rel="noopener" underline="hover">
            политику
          </Link>{' '}
          и даёте{' '}
          <Link href="/legal/consent" target="_blank" rel="noopener" underline="hover">
            согласие на обработку персональных данных
          </Link>
          .
        </Typography>

        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Link component={RouterLink} to="/register" variant="body2" sx={{ fontWeight: 600 }}>
            Зарегистрироваться
          </Link>
        </Box>
      </Card>
    </Box>
  );
}

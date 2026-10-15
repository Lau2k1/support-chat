import { useCallback, useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  TextField,
  Button,
  Typography,
  Alert,
  Checkbox,
  FormControlLabel,
  Link,
  Divider,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { LIMITS, validateEmail, validatePassword, validateRequired } from '@/utils/validation';
import TelegramLoginButton from '@/components/common/TelegramLoginButton';
import ThemeToggle from '@/components/common/ThemeToggle';
import { useColorScheme } from '@mui/material/styles';
import type { TelegramWidgetData } from '@/types';

type Mode = 'admin' | 'operator';

export default function Register() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  const [mode, setMode] = useState<Mode>('admin');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // Акцепт документов: два обязательных согласия + одно необязательное.
  const [acceptOffer, setAcceptOffer] = useState(false);
  const [acceptConsent, setAcceptConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleMode = (_: unknown, next: Mode | null) => {
    if (next) {
      setMode(next);
      setError('');
    }
  };

  /** Telegram signup creates a new client (tenant + admin) and signs in. */
  const handleTelegram = useCallback(
    async (data: TelegramWidgetData) => {
      setError('');
      setLoading(true);
      try {
        await authApi.telegramLogin(data);
        await login();
        navigate('/');
      } catch (err: any) {
        setError(err.response?.data?.error || 'Не удалось зарегистрироваться через Telegram');
      } finally {
        setLoading(false);
      }
    },
    [login, navigate]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const nameErr = validateRequired(name, 'Имя', LIMITS.operatorName);
    if (nameErr) { setError(nameErr); return; }
    const emailErr = validateEmail(email);
    if (emailErr) { setError(emailErr); return; }
    const passErr = validatePassword(password);
    if (passErr) { setError(passErr); return; }
    if (password !== password2) { setError('Пароли не совпадают'); return; }
    if (mode === 'operator' && !inviteCode.trim()) { setError('Введите инвайт-код'); return; }
    if (!acceptOffer) { setError('Подтвердите принятие Публичной оферты и Политики обработки персональных данных'); return; }
    if (!acceptConsent) { setError('Необходимо согласие на обработку персональных данных'); return; }

    setLoading(true);
    try {
      await authApi.register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
        acceptOffer,
        acceptConsent,
        marketingConsent,
        ...(mode === 'operator'
          ? { inviteCode: inviteCode.trim().toUpperCase() }
          : { company: company.trim() }),
      });
      await login();
      navigate('/');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Ошибка регистрации');
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
        // Scheme-aware halo (see Login): avoids a light-only gradient.
        backgroundImage: isDark
          ? 'radial-gradient(circle at 50% 0%, rgba(77,158,255,0.14) 0%, transparent 55%)'
          : 'radial-gradient(circle at 50% 0%, rgba(0,123,255,0.10) 0%, transparent 55%)',
        py: 3,
      }}
    >
      <Box sx={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </Box>
      <Card
        sx={{
          p: 5,
          width: 440,
          borderRadius: 3,
          boxShadow: isDark ? '0 20px 60px rgba(0,0,0,0.55)' : '0 20px 60px rgba(0,0,0,0.2)',
        }}
      >
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Support
            <Box component="span" sx={{ color: 'primary.main' }}>
              Chat
            </Box>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {mode === 'admin' ? 'Регистрация клиента' : 'Регистрация оператора'}
          </Typography>
        </Box>

        <ToggleButtonGroup
          value={mode}
          exclusive
          onChange={handleMode}
          fullWidth
          size="small"
          sx={{ mb: 2.5 }}
        >
          <ToggleButton value="admin" sx={{ textTransform: 'none', fontWeight: 600 }}>
            Я владелец сервиса
          </ToggleButton>
          <ToggleButton value="operator" sx={{ textTransform: 'none', fontWeight: 600 }}>
            У меня есть инвайт
          </ToggleButton>
        </ToggleButtonGroup>

        {mode === 'admin' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Создайте аккаунт, выберите тариф и оплатите — после оплаты станут доступны все функции и инвайты для
            операторов.
          </Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box component="form" onSubmit={handleSubmit}>
          <TextField fullWidth label="Имя" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 1.5 }} required />
          {mode === 'admin' && (
            <TextField
              fullWidth
              label="Название компании / сервиса"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              sx={{ mb: 1.5 }}
              helperText="Так будет называться ваш аккаунт"
            />
          )}
          <TextField fullWidth label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ mb: 1.5 }} required />
          <TextField fullWidth label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} sx={{ mb: 1.5 }} required />
          <TextField fullWidth label="Подтверждение пароля" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} sx={{ mb: 1.5 }} required />
          {mode === 'operator' && (
            <TextField
              fullWidth
              label="Инвайт-код"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              sx={{ mb: 2, '& input': { textTransform: 'uppercase', letterSpacing: 1 } }}
              required
            />
          )}

          <FormControlLabel
            sx={{ alignItems: 'flex-start', mb: 1, mx: 0 }}
            control={
              <Checkbox
                size="small"
                checked={acceptOffer}
                onChange={(e) => setAcceptOffer(e.target.checked)}
                sx={{ pt: 0.25 }}
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                Я принимаю{' '}
                <Link href="/legal/offer" target="_blank" rel="noopener" underline="hover">
                  Публичную оферту
                </Link>{' '}
                и{' '}
                <Link href="/legal/privacy" target="_blank" rel="noopener" underline="hover">
                  Политику обработки персональных данных
                </Link>
                , а также подтверждаю, что использую Сервис в предпринимательских целях.
              </Typography>
            }
          />

          <FormControlLabel
            sx={{ alignItems: 'flex-start', mb: 1, mx: 0 }}
            control={
              <Checkbox
                size="small"
                checked={acceptConsent}
                onChange={(e) => setAcceptConsent(e.target.checked)}
                sx={{ pt: 0.25 }}
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                Я даю{' '}
                <Link href="/legal/consent" target="_blank" rel="noopener" underline="hover">
                  согласие на обработку персональных данных
                </Link>{' '}
                в целях, указанных в согласии. Обязательно.
              </Typography>
            }
          />

          <FormControlLabel
            sx={{ alignItems: 'flex-start', mb: 2, mx: 0 }}
            control={
              <Checkbox
                size="small"
                checked={marketingConsent}
                onChange={(e) => setMarketingConsent(e.target.checked)}
                sx={{ pt: 0.25 }}
              />
            }
            label={
              <Typography variant="caption" color="text.secondary">
                Согласен получать информационные и маркетинговые сообщения. Необязательно.
              </Typography>
            }
          />

          <Button
            fullWidth
            type="submit"
            variant="contained"
            disabled={loading}
            sx={{ py: 1.5, fontWeight: 600, mt: mode === 'operator' ? 0 : 1 }}
          >
            {loading ? 'Регистрация...' : mode === 'admin' ? 'Создать аккаунт' : 'Зарегистрироваться'}
          </Button>
        </Box>

        <Divider sx={{ my: 2.5 }}>
          <Typography variant="caption" color="text.secondary">
            или
          </Typography>
        </Divider>

        <TelegramLoginButton onAuth={handleTelegram} disabled={loading} />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          Создаст нового клиента (аккаунт + тариф). Продолжая, вы принимаете{' '}
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
          <Link component={RouterLink} to="/login" variant="body2">
            Уже есть аккаунт? Войти
          </Link>
        </Box>
      </Card>
    </Box>
  );
}

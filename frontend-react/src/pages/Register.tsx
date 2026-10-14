import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Card,
  TextField,
  Button,
  Typography,
  Alert,
  Link,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { LIMITS, validateEmail, validatePassword, validateRequired } from '@/utils/validation';

type Mode = 'admin' | 'operator';

export default function Register() {
  const [mode, setMode] = useState<Mode>('admin');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleMode = (_: unknown, next: Mode | null) => {
    if (next) {
      setMode(next);
      setError('');
    }
  };

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

    setLoading(true);
    try {
      await authApi.register({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
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
        background: 'linear-gradient(145deg, #f5f7f9 0%, #ffffff 60%, #e8f2ff 100%)',
        py: 3,
      }}
    >
      <Card sx={{ p: 5, width: 440, borderRadius: 3, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Support<span style={{ color: '#007bff' }}>Chat</span>
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

        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Link component={RouterLink} to="/login" variant="body2">
            Уже есть аккаунт? Войти
          </Link>
        </Box>
      </Card>
    </Box>
  );
}

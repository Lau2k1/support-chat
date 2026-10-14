import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Box, Card, TextField, Button, Typography, Alert, Link, FormControlLabel, Checkbox } from '@mui/material';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { validateEmail } from '@/utils/validation';

export default function Login() {
  const [email, setEmail] = useState(() => localStorage.getItem('sc_remember_email') || '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('sc_remember') === '1');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

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
        background: 'linear-gradient(145deg, #f5f7f9 0%, #ffffff 60%, #e8f2ff 100%)',
      }}
    >
      <Card sx={{ p: 5, width: 360, borderRadius: 3, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <Box sx={{ textAlign: 'center', mb: 3.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Support<span style={{ color: '#007bff' }}>Chat</span>
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
          <FormControlLabel
            control={<Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
            label="Запомнить меня"
            sx={{ mb: 1.5 }}
          />
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

        <Box sx={{ textAlign: 'center', mt: 2 }}>
          <Link component={RouterLink} to="/register" variant="body2" sx={{ fontWeight: 600 }}>
            Зарегистрироваться
          </Link>
        </Box>
      </Card>
    </Box>
  );
}

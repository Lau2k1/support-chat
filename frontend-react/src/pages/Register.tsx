import { useState } from 'react';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import { Box, Card, TextField, Button, Typography, Alert, Link } from '@mui/material';
import { authApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name || !email || !password || !inviteCode) {
      setError('Заполните все поля');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }
    if (password !== password2) {
      setError('Пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.register({ name, email, password, inviteCode: inviteCode.toUpperCase() });
      login(res.data.token);
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
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Card sx={{ p: 5, width: 400, borderRadius: 3, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <Box sx={{ textAlign: 'center', mb: 3.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Support<span style={{ color: '#007bff' }}>Chat</span>
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Регистрация оператора
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box component="form" onSubmit={handleSubmit}>
          <TextField fullWidth label="Имя" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 1.5 }} required />
          <TextField fullWidth label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} sx={{ mb: 1.5 }} required />
          <TextField fullWidth label="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} sx={{ mb: 1.5 }} required />
          <TextField fullWidth label="Подтверждение пароля" type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} sx={{ mb: 1.5 }} required />
          <TextField
            fullWidth
            label="Инвайт-код"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
            sx={{ mb: 2, '& input': { textTransform: 'uppercase', letterSpacing: 1 } }}
            required
          />
          <Button fullWidth type="submit" variant="contained" disabled={loading} sx={{ py: 1.5, fontWeight: 600 }}>
            {loading ? 'Регистрация...' : 'Зарегистрироваться'}
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

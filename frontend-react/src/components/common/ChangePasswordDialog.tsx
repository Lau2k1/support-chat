import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { useUIStore } from '@/stores/uiStore';
import { authApi } from '@/services/endpoints';
import { validatePassword } from '@/utils/validation';

/**
 * Self-service password change. Verifies the current password server-side and,
 * on success, invalidates all other sessions (the current one is re-issued).
 */
export default function ChangePasswordDialog() {
  const changePasswordOpen = useUIStore((s) => s.changePasswordOpen);
  const hideChangePassword = useUIStore((s) => s.hideChangePassword);
  const showToast = useUIStore((s) => s.showToast);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    setReveal(false);
    setError('');
  };

  const close = () => {
    if (loading) return;
    reset();
    hideChangePassword();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!current) {
      setError('Введите текущий пароль');
      return;
    }
    const policyError = validatePassword(next);
    if (policyError) {
      setError(policyError);
      return;
    }
    if (next === current) {
      setError('Новый пароль должен отличаться от текущего');
      return;
    }
    if (next !== confirm) {
      setError('Новые пароли не совпадают');
      return;
    }

    setLoading(true);
    try {
      await authApi.changePassword(current, next);
      showToast('Пароль изменён. На других устройствах потребуется войти заново.');
      reset();
      hideChangePassword();
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error;
      if (status === 401) setError('Неверный текущий пароль');
      else if (status === 429) setError('Слишком много попыток, попробуйте позже');
      else setError(serverMsg || 'Не удалось изменить пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={changePasswordOpen} onClose={close} maxWidth="xs" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Смена пароля</DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <TextField
            fullWidth
            autoFocus
            label="Текущий пароль"
            type={reveal ? 'text' : 'password'}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            disabled={loading}
            sx={{ mb: 2, mt: 0.5 }}
          />
          <TextField
            fullWidth
            label="Новый пароль"
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            disabled={loading}
            helperText="Минимум 8 символов"
            sx={{ mb: 2 }}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setReveal((v) => !v)}
                      edge="end"
                      tabIndex={-1}
                      aria-label="Показать пароль"
                    >
                      {reveal ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <TextField
            fullWidth
            label="Повторите новый пароль"
            type={reveal ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            disabled={loading}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close} color="inherit" disabled={loading}>
            Отмена
          </Button>
          <Button type="submit" variant="contained" disabled={loading}>
            {loading ? 'Сохранение...' : 'Сменить пароль'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

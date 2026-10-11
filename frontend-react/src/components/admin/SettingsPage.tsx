import { useState, useEffect } from 'react';
import { Typography, TextField, Button, Paper } from '@mui/material';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { LIMITS, clampIntInput } from '@/utils/validation';
import type { Settings } from '@/types';

export default function SettingsPage({ tenantId }: { tenantId?: number } = {}) {
  const [timeout, setTimeout_] = useState('7');  const [welcome, setWelcome] = useState('');
  const [loading, setLoading] = useState(true);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi.getSettings(tenantId);
        setTimeout_(res.data.chat_timeout_minutes || '7');
        setWelcome(res.data.welcome_message || '');
      } catch { showToast('Ошибка загрузки настроек', 'error'); }
      finally { setLoading(false); }
    };
    load();
  }, [showToast, tenantId]);

  const handleSave = async () => {
    const timeoutNum = Number(timeout);
    if (
      !Number.isInteger(timeoutNum) ||
      timeoutNum < LIMITS.chatTimeoutMin ||
      timeoutNum > LIMITS.chatTimeoutMax
    ) {
      showToast(
        `Время авто-закрытия: целое число ${LIMITS.chatTimeoutMin}–${LIMITS.chatTimeoutMax} минут`,
        'error'
      );
      return;
    }
    if (welcome.length > LIMITS.welcomeMessage) {
      showToast(`Приветственное сообщение: максимум ${LIMITS.welcomeMessage} символов`, 'error');
      return;
    }
    try {
      await adminApi.saveSettings(
        { chat_timeout_minutes: String(timeoutNum), welcome_message: welcome },
        tenantId
      );
      showToast('Настройки сохранены');
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка сохранения', 'error');
    }
  };

  if (loading) return <Typography color="text.secondary">Загрузка...</Typography>;

  return (
    <Paper sx={{ p: 2.5, maxWidth: 600 }}>
      <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 2.5 }}>Настройки системы</Typography>

      <TextField
        fullWidth
        label="Время авто-закрытия чатов (минуты)"
        type="number"
        value={timeout}
        onChange={(e) =>
          setTimeout_(clampIntInput(e.target.value, LIMITS.chatTimeoutMin, LIMITS.chatTimeoutMax))
        }
        slotProps={{ htmlInput: { min: LIMITS.chatTimeoutMin, max: LIMITS.chatTimeoutMax } }}
        helperText={`От ${LIMITS.chatTimeoutMin} до ${LIMITS.chatTimeoutMax} минут`}
        sx={{ mb: 2.5 }}
      />

      <TextField
        fullWidth
        label="Приветственное сообщение"
        multiline
        rows={3}
        value={welcome}
        onChange={(e) => setWelcome(e.target.value)}
        slotProps={{ htmlInput: { maxLength: LIMITS.welcomeMessage } }}
        helperText={`${welcome.length}/${LIMITS.welcomeMessage} символов`}
        sx={{ mb: 2.5 }}
      />

      <Button variant="contained" onClick={handleSave}>Сохранить</Button>
    </Paper>
  );
}

import { useState, useEffect } from 'react';
import { Box, Typography, TextField, Button, Paper } from '@mui/material';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { Settings } from '@/types';

export default function SettingsPage({ tenantId }: { tenantId?: number } = {}) {
  const [timeout, setTimeout_] = useState('7');
  const [welcome, setWelcome] = useState('');
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
    try {
      await adminApi.saveSettings({ chat_timeout_minutes: timeout, welcome_message: welcome }, tenantId);
      showToast('Настройки сохранены');
    } catch { showToast('Ошибка сохранения', 'error'); }
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
        onChange={(e) => setTimeout_(e.target.value)}
        slotProps={{ htmlInput: { min: 1, max: 60 } }}
        sx={{ mb: 2.5 }}
      />

      <TextField
        fullWidth
        label="Приветственное сообщение"
        multiline
        rows={3}
        value={welcome}
        onChange={(e) => setWelcome(e.target.value)}
        sx={{ mb: 2.5 }}
      />

      <Button variant="contained" onClick={handleSave}>Сохранить</Button>
    </Paper>
  );
}

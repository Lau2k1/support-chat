import { useState, useEffect } from 'react';
import { Typography, TextField, Button, Paper } from '@mui/material';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { LIMITS, clampIntInput } from '@/utils/validation';

/** Parses the stored widget_origins JSON into a newline-separated string. */
function originsToText(raw?: string): string {
  if (!raw) return '';
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.join('\n') : '';
  } catch {
    return '';
  }
}

/** Newline-separated string → clean array of http(s) URLs. */
function textToOrigins(text: string): string[] | null {
  const list = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.every((o) => /^https?:\/\//i.test(o))) return null;
  return list;
}

export default function SettingsPage({ tenantId }: { tenantId?: number } = {}) {
  const [timeout, setTimeout_] = useState('7');
  const [welcome, setWelcome] = useState('');
  const [origins, setOrigins] = useState('');
  const [loading, setLoading] = useState(true);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi.getSettings(tenantId);
        setTimeout_(res.data.chat_timeout_minutes || '7');
        setWelcome(res.data.welcome_message || '');
        setOrigins(originsToText(res.data.widget_origins));
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
    const originList = textToOrigins(origins);
    if (originList === null) {
      showToast('Домены виджета: по одному URL на строку (http/https)', 'error');
      return;
    }
    try {
      await adminApi.saveSettings(
        {
          chat_timeout_minutes: String(timeoutNum),
          welcome_message: welcome,
          widget_origins: JSON.stringify(originList),
        },
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

      <TextField
        fullWidth
        label="Домены для встраивания виджета (по одному на строку)"
        multiline
        rows={3}
        value={origins}
        onChange={(e) => setOrigins(e.target.value)}
        placeholder={'https://client-site.ru\nhttps://shop.example.com'}
        helperText="Разрешает встраивание виджета в iframe только с этих доменов"
        sx={{ mb: 2.5 }}
      />

      <Button variant="contained" onClick={handleSave}>Сохранить</Button>
    </Paper>
  );
}

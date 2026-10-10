import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Alert,
  Chip,
  Switch,
  Divider,
  Link,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { TelegramBot } from '@/types';

export default function TelegramBotPage() {
  const [bot, setBot] = useState<TelegramBot | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const load = async () => {
    try {
      const res = await adminApi.getTelegramBot();
      setBot(res.data.bot);
      setWebhookUrl(res.data.webhook_url);
    } catch {
      showToast('Ошибка загрузки бота', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setBusy(true);
    try {
      const res = await adminApi.connectTelegramBot(token.trim());
      setBot(res.data.bot);
      setWebhookUrl(res.data.webhook_url);
      setToken('');
      setShowTokenForm(false);
      if (res.data.webhook_registered) showToast('Бот подключён, вебхук зарегистрирован');
      else if (res.data.webhook_url) showToast('Бот подключён, но вебхук не зарегистрирован: ' + (res.data.webhook_error || 'ошибка'), 'error');
      else showToast('Бот подключён. Задайте PUBLIC_BASE_URL, чтобы включить вебхук');
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось подключить бота', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (isActive: boolean) => {
    setBusy(true);
    try {
      const res = await adminApi.toggleTelegramBot(isActive);
      setBot(res.data.bot);
      showToast(isActive ? 'Бот включён' : 'Бот выключен');
    } catch {
      showToast('Ошибка переключения', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Отключить Telegram-бота? Сообщения из Telegram перестанут поступать.')) return;
    setBusy(true);
    try {
      await adminApi.disconnectTelegramBot();
      setBot(null);
      setWebhookUrl(null);
      showToast('Бот отключён');
    } catch {
      showToast('Ошибка отключения', 'error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Typography color="text.secondary">Загрузка...</Typography>;

  return (
    <Paper sx={{ p: 2.5, maxWidth: 720 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <SendIcon color="primary" />
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Telegram-бот</Typography>
      </Box>

      {!bot ? (
        <>
          <Alert severity="info" sx={{ mb: 2 }}>
            Подключите собственного бота, чтобы принимать обращения из Telegram. Один бот на аккаунт.
          </Alert>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 0.5 }}>
            1. Откройте в Telegram <Link href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</Link>.
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 0.5 }}>
            2. Выполните <code>/newbot</code> и придумайте имя.
          </Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
            3. Скопируйте токен вида <code>123456:AA...</code> и вставьте ниже.
          </Typography>
          <TextField
            fullWidth
            label="Токен бота"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="123456789:AA..."
            sx={{ mb: 2 }}
          />
          <Button variant="contained" onClick={handleConnect} disabled={busy || !token.trim()}>
            Подключить
          </Button>
        </>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
            <Chip
              label={bot.is_active ? 'Активен' : 'Выключен'}
              color={bot.is_active ? 'success' : 'default'}
              size="small"
            />
            <Typography sx={{ fontWeight: 600 }}>
              @{bot.bot_username || 'bot'}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Switch checked={bot.is_active} onChange={(e) => handleToggle(e.target.checked)} disabled={busy} />
            <Typography sx={{ fontSize: 13 }}>Принимать сообщения из Telegram</Typography>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography sx={{ fontWeight: 600, fontSize: 13, mb: 0.5 }}>Вебхук</Typography>
          {webhookUrl ? (
            <>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.5 }}>
                Telegram отправляет обновления на этот адрес:
              </Typography>
              <Box sx={{ bgcolor: '#f5f5f5', borderRadius: 1, px: 1.5, py: 1, fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all', mb: 2 }}>
                {webhookUrl}
              </Box>
            </>
          ) : (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <code>PUBLIC_BASE_URL</code> не задан — вебхук не зарегистрирован автоматически.
              Укажите публичный адрес платформы в переменных окружения бэкенда и переподключите бота.
            </Alert>
          )}

          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
            Клиенты пишут боту в Telegram — диалоги появляются в операторской с пометкой «Telegram».
            Ответы операторов доставляются обратно в Telegram.
          </Typography>

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button variant="outlined" onClick={() => setShowTokenForm((v) => !v)} disabled={busy}>
              Заменить токен
            </Button>
            <Button variant="outlined" color="error" onClick={handleDisconnect} disabled={busy}>
              Отключить
            </Button>
          </Box>

          {showTokenForm && (
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="Новый токен бота"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AA..."
                sx={{ mb: 2 }}
              />
              <Button variant="contained" onClick={handleConnect} disabled={busy || !token.trim()}>
                Сохранить токен
              </Button>
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}

import { useState } from 'react';
import { Box, Button, Link, Paper, Typography } from '@mui/material';

/**
 * Cookie-уведомление панели. Сервис использует только технически необходимые
 * cookie (сессия входа `sc_token`) и localStorage (тема, «запомнить email»);
 * аналитики и рекламных трекеров нет, поэтому баннер информационный — он ничего
 * не блокирует и не требует «согласия» на то, без чего панель не работает.
 *
 * Отметка о показе хранится в localStorage; версия в ключе позволяет показать
 * уведомление заново, если состав cookie изменится.
 */
const STORAGE_KEY = 'sc_cookie_consent';
const NOTICE_VERSION = 1;

function alreadyAccepted(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { v?: number };
    return parsed?.v === NOTICE_VERSION;
  } catch {
    return false;
  }
}

export default function CookieNotice() {
  const [open, setOpen] = useState(() => !alreadyAccepted());

  if (!open) return null;

  const accept = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: NOTICE_VERSION, ts: new Date().toISOString() }));
    } catch {
      /* приватный режим: просто закрываем уведомление */
    }
    setOpen(false);
  };

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'fixed',
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: (theme) => theme.zIndex.snackbar,
        maxWidth: 720,
        mx: 'auto',
        p: 2,
        display: 'flex',
        gap: 2,
        alignItems: 'center',
        flexWrap: 'wrap',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 320px' }}>
        Мы используем только технически необходимые cookie: они нужны для входа в панель и сохранения
        настроек. Аналитики и рекламных трекеров нет. Подробнее —{' '}
        <Link href="/legal/cookies" target="_blank" rel="noopener" underline="hover">
          Файлы cookie
        </Link>
        .
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <Button variant="contained" size="small" onClick={accept}>
          Понятно
        </Button>
      </Box>
    </Paper>
  );
}

import { useState } from 'react';
import { Box } from '@mui/material';
import AdminSideNav from '@/components/admin/AdminSideNav';
import OperatorsPage from '@/components/admin/OperatorsPage';
import InvitesPage from '@/components/admin/InvitesPage';
import TagsPage from '@/components/admin/TagsPage';
import SettingsPage from '@/components/admin/SettingsPage';
import AuditPage from '@/components/admin/AuditPage';
import AdminStatsPage from '@/components/admin/AdminStatsPage';
import TelegramBotPage from '@/components/admin/TelegramBotPage';

type AdminPage = 'operators' | 'invites' | 'tags' | 'settings' | 'audit' | 'stats' | 'telegram';

export default function AdminPanel() {
  const [page, setPage] = useState<AdminPage>('operators');

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AdminSideNav current={page} onChange={setPage} />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box
          sx={{
            height: 52,
            bgcolor: '#fff',
            px: 3,
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            fontWeight: 600,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {pageTitles[page]}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {page === 'operators' && <OperatorsPage />}
          {page === 'invites' && <InvitesPage />}
          {page === 'tags' && <TagsPage />}
          {page === 'settings' && <SettingsPage />}
          {page === 'audit' && <AuditPage />}
          {page === 'stats' && <AdminStatsPage />}
          {page === 'telegram' && <TelegramBotPage />}
        </Box>
      </Box>
    </Box>
  );
}

const pageTitles: Record<AdminPage, string> = {
  operators: 'Операторы',
  invites: 'Инвайт-коды',
  tags: 'Теги',
  settings: 'Настройки системы',
  audit: 'Аудит чатов',
  stats: 'Статистика по операторам',
  telegram: 'Telegram-бот',
};
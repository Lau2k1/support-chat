import { Box, Typography } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import DescriptionIcon from '@mui/icons-material/Description';
import LabelIcon from '@mui/icons-material/Label';
import SettingsIcon from '@mui/icons-material/Settings';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import BarChartIcon from '@mui/icons-material/BarChart';
import SendIcon from '@mui/icons-material/Send';
import ChatIcon from '@mui/icons-material/Chat';
import LogoutIcon from '@mui/icons-material/Logout';
import KeyIcon from '@mui/icons-material/Key';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import TelegramIcon from '@mui/icons-material/Telegram';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { wsManager } from '@/services/ws';
import ThemeToggle from '@/components/common/ThemeToggle';

type Page = 'operators' | 'invites' | 'tags' | 'settings' | 'audit' | 'stats' | 'telegram' | 'billing' | 'ticket-templates' | 'tickets';

const items: { page: Page; icon: React.ReactNode; label: string }[] = [
  { page: 'operators', icon: <PeopleIcon fontSize="small" />, label: 'Операторы' },
  { page: 'invites', icon: <ConfirmationNumberIcon fontSize="small" />, label: 'Инвайты' },
  { page: 'tickets', icon: <FactCheckIcon fontSize="small" />, label: 'Тикеты' },
  { page: 'ticket-templates', icon: <DescriptionIcon fontSize="small" />, label: 'Шаблоны тикетов' },
  { page: 'stats', icon: <BarChartIcon fontSize="small" />, label: 'Статистика' },
  { page: 'audit', icon: <FactCheckIcon fontSize="small" />, label: 'Аудит' },
  { page: 'telegram', icon: <SendIcon fontSize="small" />, label: 'Telegram-бот' },
  { page: 'settings', icon: <SettingsIcon fontSize="small" />, label: 'Настройки' },
  { page: 'tags', icon: <LabelIcon fontSize="small" />, label: 'Теги' },
  { page: 'billing', icon: <CreditCardIcon fontSize="small" />, label: 'Оплата' },
];

interface Props {
  current: Page;
  onChange: (page: Page) => void;
}

export default function AdminSideNav({ current, onChange }: Props) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const showChangePassword = useUIStore((s) => s.showChangePassword);
  const showTelegram = useUIStore((s) => s.showTelegram);
  const telegramLinked = useAuthStore((s) => s.user?.telegram?.linked ?? false);

  const handleLogout = () => {
    showConfirm({
      text: 'Выйти из админ-панели?',
      confirmLabel: 'Выйти',
      onConfirm: () => {
        wsManager.disconnect();
        logout();
      },
    });
  };

  return (
    <Box
      sx={{
        width: 220,
        bgcolor: '#1e293b',
        color: '#e2e8f0',
        // Fixed dark chrome: a translucent separator stays visible in both schemes.
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <Box sx={{ px: 2, py: 2.2, borderBottom: '1px solid #334155' }}>
        <Typography sx={{ fontWeight: 700, fontSize: 16 }}>
          Support<span style={{ color: '#007bff' }}>Chat</span>
        </Typography>
        <Typography color="#94a3b8" sx={{ mt: 0.3, fontSize: 11 }}>
          Админ-панель
        </Typography>
      </Box>

      <Box sx={{ flex: 1, py: 1 }}>
        {items.map((item) => (
          <Box
            key={item.page}
            onClick={() => onChange(item.page)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.2,
              px: 2,
              py: 1.4,
              cursor: 'pointer',
              color: current === item.page ? '#fff' : '#94a3b8',
              bgcolor: current === item.page ? '#334155' : 'transparent',
              '&:hover': {
                color: '#e2e8f0',
                bgcolor: current === item.page ? '#334155' : 'rgba(255,255,255,0.05)',
              },
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            {item.icon}
            {item.label}
          </Box>
        ))}
      </Box>

      <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid #334155' }}>
        <Box
          onClick={() => navigate('/operator')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 12,
            mb: 1.2,
            '&:hover': { color: '#e2e8f0' },
          }}
        >
          <ChatIcon sx={{ fontSize: 14 }} />
          К операторской
        </Box>
        <Box
          onClick={showChangePassword}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 12,
            mb: 1.2,
            '&:hover': { color: '#e2e8f0' },
          }}
        >
          <KeyIcon sx={{ fontSize: 14 }} />
          Сменить пароль
        </Box>
        <Box
          onClick={showTelegram}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: telegramLinked ? '#4ade80' : '#94a3b8',
            cursor: 'pointer',
            fontSize: 12,
            mb: 1.2,
            '&:hover': { color: '#e2e8f0' },
          }}
        >
          <TelegramIcon sx={{ fontSize: 14 }} />
          {telegramLinked ? 'Telegram привязан' : 'Привязать Telegram'}
        </Box>
        <ThemeToggle row onDarkSurface />
        <Box
          onClick={handleLogout}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 12,
            '&:hover': { color: '#ef4444' },
          }}
        >
          <LogoutIcon sx={{ fontSize: 14 }} />
          Выйти
        </Box>
      </Box>
    </Box>
  );
}
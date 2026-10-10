import { Box, IconButton, Typography } from '@mui/material';
import DashboardIcon from '@mui/icons-material/Dashboard';
import DomainIcon from '@mui/icons-material/Domain';
import SendIcon from '@mui/icons-material/Send';
import LogoutIcon from '@mui/icons-material/Logout';
import ChatIcon from '@mui/icons-material/Chat';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { wsManager } from '@/services/ws';

type Page = 'overview' | 'tenants' | 'bots';

const items: { page: Page; icon: React.ReactNode; label: string }[] = [
  { page: 'overview', icon: <DashboardIcon fontSize="small" />, label: 'Обзор' },
  { page: 'tenants', icon: <DomainIcon fontSize="small" />, label: 'Тенанты & инвайты' },
  { page: 'bots', icon: <SendIcon fontSize="small" />, label: 'Telegram-боты' },
];

interface Props {
  current: Page;
  onChange: (page: Page) => void;
}

export default function OwnerSideNav({ current, onChange }: Props) {
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const handleLogout = () => {
    wsManager.disconnect();
    logout();
  };

  return (
    <Box
      sx={{
        width: 230,
        bgcolor: '#111827',
        color: '#e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <Box sx={{ px: 2, py: 2.2, borderBottom: '1px solid #1f2937' }}>
        <Typography sx={{ fontWeight: 700, fontSize: 16 }}>
          Support<span style={{ color: '#007bff' }}>Chat</span>
        </Typography>
        <Typography color="#6b7280" sx={{ mt: 0.3, fontSize: 11 }}>
          Кабинет владельца
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
              color: current === item.page ? '#fff' : '#9ca3af',
              bgcolor: current === item.page ? '#1f2937' : 'transparent',
              '&:hover': {
                color: '#f3f4f6',
                bgcolor: current === item.page ? '#1f2937' : 'rgba(255,255,255,0.05)',
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

      <Box sx={{ px: 2, py: 1.5, borderTop: '1px solid #1f2937' }}>
        <Box
          onClick={() => navigate('/operator')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: '#9ca3af',
            cursor: 'pointer',
            fontSize: 12,
            mb: 1.2,
            '&:hover': { color: '#f3f4f6' },
          }}
        >
          <ChatIcon sx={{ fontSize: 14 }} />
          К операторской
        </Box>
        <Box
          onClick={handleLogout}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: '#9ca3af',
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
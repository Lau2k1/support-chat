import { useState } from 'react';
import {
  Box,
  IconButton,
  Typography,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Chip,
  Button,
} from '@mui/material';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import LogoutIcon from '@mui/icons-material/Logout';
import KeyIcon from '@mui/icons-material/Key';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ForumIcon from '@mui/icons-material/Forum';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { wsManager } from '@/services/ws';
import ThemeToggle from '@/components/common/ThemeToggle';
import StatusDot from '@/components/common/StatusDot';
import UserAvatar from '@/components/common/UserAvatar';
import { chatLayout } from '@/theme';

const statusLabels = { online: 'Онлайн', busy: 'Занят', offline: 'Оффлайн' };
const roleLabels = { superadmin: 'Владелец', admin: 'Администратор', operator: 'Оператор' };

export default function TopBar() {
  const { isAdmin, isSuperadmin, logout } = useAuthStore();
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const { openTabs, currentChatId, chatPublicCodes, operatorStatus, setOperatorStatus } = useChatStore();
  const showConfirm = useUIStore((s) => s.showConfirm);
  const showChangePassword = useUIStore((s) => s.showChangePassword);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleStatusChange = (status: 'online' | 'busy' | 'offline') => {
    setOperatorStatus(status);
    wsManager.send({ type: 'operator_status', status });
    setAnchorEl(null);
  };

  const handleLogout = () => {
    showConfirm({
      text: 'Выйти из аккаунта?',
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
        height: chatLayout.topBarHeight,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        px: 2,
        gap: 1.5,
        flexShrink: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            // Фирменный градиент из токенов палитры: в тёмной схеме он светлее.
            background: (t) => `linear-gradient(135deg, ${t.palette.primary.light} 0%, ${t.palette.primary.main} 100%)`,
            color: 'primary.contrastText',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ForumIcon sx={{ fontSize: 18 }} />
        </Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          Support
          <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400 }}>
            Chat
          </Box>
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', gap: 0.5, overflowX: 'auto', px: 1 }}>
        {openTabs.map((tabId) => (
          <Chip
            key={tabId}
            label={chatPublicCodes[String(tabId)] || `#${tabId}`}
            color={tabId === currentChatId ? 'primary' : 'default'}
            variant={tabId === currentChatId ? 'filled' : 'outlined'}
            size="small"
            onClick={() => useChatStore.getState().setCurrentChat(tabId)}
            onDelete={() => useChatStore.getState().removeTab(tabId)}
            sx={{ fontWeight: 600, fontSize: 12 }}
          />
        ))}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
        <Button
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          startIcon={<StatusDot status={operatorStatus} size={9} />}
          endIcon={<ExpandMoreIcon sx={{ fontSize: 16 }} />}
          sx={{
            textTransform: 'none',
            fontSize: 12,
            fontWeight: 600,
            color: 'text.primary',
            borderColor: 'divider',
            borderRadius: 999,
            px: 1.25,
          }}
          variant="outlined"
        >
          {statusLabels[operatorStatus]}
        </Button>
        <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
          {(['online', 'busy', 'offline'] as const).map((s) => (
            <MenuItem key={s} onClick={() => handleStatusChange(s)}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <StatusDot status={s} size={9} />
              </ListItemIcon>
              <ListItemText>{statusLabels[s]}</ListItemText>
            </MenuItem>
          ))}
        </Menu>

        {isSuperadmin && (
          <IconButton
            size="small"
            onClick={() => navigate('/crm')}
            sx={{ bgcolor: 'navBg', color: 'navTextActive', borderRadius: 1, px: 1 }}
          >
            <AdminPanelSettingsIcon sx={{ fontSize: 16 }} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, ml: 0.5 }}>CRM</Typography>
          </IconButton>
        )}
        {isAdmin && !isSuperadmin && (
          <IconButton
            size="small"
            onClick={() => navigate('/admin')}
            sx={{ bgcolor: 'navBg', color: 'navTextActive', borderRadius: 1, px: 1 }}
          >
            <AdminPanelSettingsIcon sx={{ fontSize: 16 }} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, ml: 0.5 }}>Админ</Typography>
          </IconButton>
        )}

        <ThemeToggle />

        <IconButton size="small" onClick={showChangePassword} title="Сменить пароль">
          <KeyIcon fontSize="small" />
        </IconButton>

        <IconButton size="small" onClick={handleLogout} title="Выйти">
          <LogoutIcon fontSize="small" />
        </IconButton>

        {user && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              pl: 1.5,
              borderLeft: '1px solid',
              borderColor: 'divider',
            }}
          >
            <UserAvatar name={user.name} variant="solid" size={32} />
            <Box sx={{ display: { xs: 'none', sm: 'block' }, lineHeight: 1.25 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{user.name}</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{roleLabels[user.role]}</Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
}

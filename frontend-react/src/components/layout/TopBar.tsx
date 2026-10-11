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
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { wsManager } from '@/services/ws';

const statusColors = { online: '#4ade80', busy: '#f59e0b', offline: '#94a3b8' };
const statusLabels = { online: 'Онлайн', busy: 'Занят', offline: 'Оффлайн' };

export default function TopBar() {
  const { isAdmin, isSuperadmin, logout } = useAuthStore();
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
        height: 52,
        background: '#fff',
        borderBottom: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        alignItems: 'center',
        px: 2,
        gap: 1,
        flexShrink: 0,
      }}
    >
      <Typography variant="subtitle1" sx={{ fontWeight: 700, mr: 1 }} color="primary">
        Support<span style={{ color: '#64748b', fontWeight: 400 }}>Chat</span>
      </Typography>

      <Box sx={{ flex: 1, display: 'flex', gap: 0.5, overflowX: 'auto', px: 1 }}>
        {openTabs.map((tabId) => (
          <Chip
            key={tabId}
            label={`Чат ${chatPublicCodes[String(tabId)] || `#${tabId}`}`}
            color={tabId === currentChatId ? 'primary' : 'default'}
            size="small"
            onClick={() => useChatStore.getState().setCurrentChat(tabId)}
            onDelete={() => useChatStore.getState().removeTab(tabId)}
            sx={{ fontWeight: 500 }}
          />
        ))}
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Button
          size="small"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          startIcon={
            <Box
              component="span"
              sx={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                bgcolor: statusColors[operatorStatus],
                display: 'inline-block',
              }}
            />
          }
          variant="outlined"
          sx={{ textTransform: 'none', fontSize: 12, fontWeight: 600 }}
        >
          {statusLabels[operatorStatus]}
        </Button>
        <Menu anchorEl={anchorEl} open={!!anchorEl} onClose={() => setAnchorEl(null)}>
          {(['online', 'busy', 'offline'] as const).map((s) => (
            <MenuItem key={s} onClick={() => handleStatusChange(s)}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: statusColors[s],
                    display: 'inline-block',
                  }}
                />
              </ListItemIcon>
              <ListItemText>{statusLabels[s]}</ListItemText>
            </MenuItem>
          ))}
        </Menu>

        {isSuperadmin && (
          <IconButton size="small" onClick={() => navigate('/crm')} sx={{ bgcolor: '#111827', color: '#fff', borderRadius: 1, px: 1 }}>
            <AdminPanelSettingsIcon sx={{ fontSize: 16 }} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, ml: 0.5 }}>CRM</Typography>
          </IconButton>
        )}
        {isAdmin && !isSuperadmin && (
          <IconButton size="small" onClick={() => navigate('/admin')} sx={{ bgcolor: '#1e293b', color: '#fff', borderRadius: 1, px: 1 }}>
            <AdminPanelSettingsIcon sx={{ fontSize: 16 }} />
            <Typography sx={{ fontSize: 11, fontWeight: 600, ml: 0.5 }}>Админ</Typography>
          </IconButton>
        )}

        <IconButton size="small" onClick={showChangePassword} title="Сменить пароль">
          <KeyIcon fontSize="small" />
        </IconButton>

        <IconButton size="small" onClick={handleLogout} title="Выйти">
          <LogoutIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

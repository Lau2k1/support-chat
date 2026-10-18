import { Box, IconButton, Typography } from '@mui/material';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import BarChartIcon from '@mui/icons-material/BarChart';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import LockIcon from '@mui/icons-material/Lock';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import UnreadBadge from '@/components/common/UnreadBadge';
import { chatLayout } from '@/theme';

type ViewType = 'chats' | 'archive' | 'stats' | 'tickets';

interface SideNavProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const navItems: { view: ViewType; icon: React.ReactNode; label: string }[] = [
  { view: 'chats', icon: <ChatBubbleIcon />, label: 'Чаты' },
  { view: 'archive', icon: <Inventory2Icon />, label: 'Архив' },
  { view: 'tickets', icon: <ConfirmationNumberIcon />, label: 'Тикеты' },
  { view: 'stats', icon: <BarChartIcon />, label: 'Стат.' },
];

export default function SideNav({ currentView, onViewChange }: SideNavProps) {
  const canUseTickets = useAuthStore((s) => s.canUseTickets);
  // Сводный счётчик непрочитанных по всем чатам — тот же, что видит список.
  const unreadTotal = useChatStore((s) =>
    Object.values(s.chatUnread).reduce((sum, n) => sum + (n || 0), 0)
  );

  return (
    <Box
      sx={{
        width: chatLayout.navWidth,
        bgcolor: 'navBg',
        // The nav keeps its fixed dark chrome in both schemes, so the separator is a
        // translucent white rather than 'divider' (which is light in light mode and
        // would vanish against paper in dark mode).
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pt: 1.25,
        flexShrink: 0,
      }}
    >
      {navItems.map((item) => (
        <IconButton
          key={item.view}
          onClick={() => onViewChange(item.view)}
          sx={{
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            py: 1.3,
            borderRadius: 0,
            position: 'relative',
            color: currentView === item.view ? 'navTextActive' : 'navText',
            bgcolor: currentView === item.view ? 'navActive' : 'transparent',
            '&:hover': {
              color: 'navTextActive',
              bgcolor: currentView === item.view ? 'navActive' : 'rgba(255,255,255,0.05)',
            },
          }}
        >
          {item.view === 'tickets' && !canUseTickets ? (
            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              {item.icon}
              <LockIcon
                sx={{
                  position: 'absolute',
                  right: -7,
                  bottom: -3,
                  fontSize: 12,
                  color: 'statusBusy',
                }}
              />
            </Box>
          ) : (
            item.icon
          )}
          <Typography sx={{ fontSize: 11, fontWeight: 600, mt: 0.5, letterSpacing: 0.3 }}>
            {item.label}
          </Typography>
          {item.view === 'chats' && unreadTotal > 0 && (
            <UnreadBadge
              count={unreadTotal}
              sx={{ position: 'absolute', top: 8, right: 14, minWidth: 18, height: 18, fontSize: 10, px: 0.5 }}
            />
          )}
        </IconButton>
      ))}
    </Box>
  );
}

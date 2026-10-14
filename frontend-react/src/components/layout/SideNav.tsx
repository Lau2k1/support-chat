import { Box, IconButton, Typography } from '@mui/material';
import ChatBubbleIcon from '@mui/icons-material/ChatBubble';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import BarChartIcon from '@mui/icons-material/BarChart';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';

type ViewType = 'chats' | 'archive' | 'stats' | 'tickets';

interface SideNavProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
}

const navItems: { view: ViewType; icon: React.ReactNode; label: string }[] = [
  { view: 'chats', icon: <ChatBubbleIcon fontSize="small" />, label: 'Чаты' },
  { view: 'archive', icon: <Inventory2Icon fontSize="small" />, label: 'Архив' },
  { view: 'tickets', icon: <ConfirmationNumberIcon fontSize="small" />, label: 'Тикеты' },
  { view: 'stats', icon: <BarChartIcon fontSize="small" />, label: 'Стат.' },
];

export default function SideNav({ currentView, onViewChange }: SideNavProps) {
  return (
    <Box
      sx={{
        width: 70,
        bgcolor: '#1e293b',
        // The nav keeps its fixed dark chrome in both schemes, so the separator is a
        // translucent white rather than 'divider' (which is light in light mode and
        // would vanish against paper in dark mode).
        borderRight: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        pt: 1,
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
            py: 1.2,
            borderRadius: 0,
            color: currentView === item.view ? '#fff' : '#94a3b8',
            bgcolor: currentView === item.view ? '#334155' : 'transparent',
            '&:hover': {
              color: '#e2e8f0',
              bgcolor: currentView === item.view ? '#334155' : 'rgba(255,255,255,0.05)',
            },
          }}
        >
          {item.icon}
          <Typography sx={{ fontSize: 10, fontWeight: 600, mt: 0.3, letterSpacing: 0.3 }}>
            {item.label}
          </Typography>
        </IconButton>
      ))}
    </Box>
  );
}

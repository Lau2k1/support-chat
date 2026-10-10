import { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  List,
  ListItemButton,
  ListItemAvatar,
  ListItemText,
  Avatar,
  Typography,
  Badge,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useChatStore } from '@/stores/chatStore';
import { formatElapsedTime } from '@/utils/format';

interface ChatSidebarProps {
  onSelectChat: (chatId: number) => void;
  currentChatId: number | null;
}

export default function ChatSidebar({ onSelectChat, currentChatId }: ChatSidebarProps) {
  const { chatTimers, chatUnread, chatPreviews, chatSources, chatNames } = useChatStore();
  const [search, setSearch] = useState('');
  const [chatIds, setChatIds] = useState<number[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const ids = Object.keys(chatTimers).map(Number).sort((a, b) => {
      return (chatTimers[String(b)] || 0) - (chatTimers[String(a)] || 0);
    });
    setChatIds(ids);
  }, [chatTimers]);

  const filtered = chatIds.filter((id) =>
    String(id).includes(search.toLowerCase())
  );

  const waitingIds = filtered.filter((id) => {
    const timer = chatTimers[String(id)];
    if (!timer) return false;
    const diff = Math.floor((now - timer) / 1000);
    return diff >= 60 && id !== currentChatId;
  });

  const activeIds = filtered.filter((id) => !waitingIds.includes(id));

  return (
    <Box
      sx={{
        width: 280,
        bgcolor: '#fff',
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <Box sx={{ p: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Box>

      <List sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
        {waitingIds.length > 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, fontWeight: 600, textTransform: 'uppercase' }}>
            Ожидающие
          </Typography>
        )}
        {waitingIds.map((id) => (
          <ChatItem
            key={id}
            chatId={id}
            isActive={id === currentChatId}
            isWaiting
            timer={chatTimers[String(id)]}
            preview={chatPreviews[String(id)]}
            source={chatSources[String(id)]}
            name={chatNames[String(id)]}
            unread={chatUnread[String(id)] || 0}
            now={now}
            onClick={() => onSelectChat(id)}
          />
        ))}

        <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, fontWeight: 600, textTransform: 'uppercase' }}>
          Активные
        </Typography>
        {activeIds.map((id) => (
          <ChatItem
            key={id}
            chatId={id}
            isActive={id === currentChatId}
            isWaiting={false}
            timer={chatTimers[String(id)]}
            preview={chatPreviews[String(id)]}
            source={chatSources[String(id)]}
            name={chatNames[String(id)]}
            unread={chatUnread[String(id)] || 0}
            now={now}
            onClick={() => onSelectChat(id)}
          />
        ))}

        {filtered.length === 0 && (
          <Typography color="text.secondary" sx={{ p: 2, textAlign: 'center', fontSize: 13 }}>
            Нет чатов
          </Typography>
        )}
      </List>
    </Box>
  );
}

function ChatItem({
  chatId,
  isActive,
  isWaiting,
  timer,
  preview,
  source,
  name,
  unread,
  now,
  onClick,
}: {
  chatId: number;
  isActive: boolean;
  isWaiting: boolean;
  timer?: number;
  preview?: string;
  source?: string;
  name?: string;
  unread: number;
  now: number;
  onClick: () => void;
}) {
  const elapsed = timer ? formatElapsedTime(timer) : '...';
  const isTelegram = source === 'telegram';
  const label = name || `${isTelegram ? 'Telegram' : 'Клиент'} #${chatId}`;

  return (
    <ListItemButton
      onClick={onClick}
      selected={isActive}
      sx={{
        borderLeft: isWaiting ? '3px solid #f59e0b' : isActive ? '3px solid #007bff' : '3px solid transparent',
        bgcolor: isWaiting ? '#fffbeb' : undefined,
        '&.Mui-selected': { bgcolor: '#eff6ff' },
      }}
    >
      <ListItemAvatar>
        <Avatar sx={{ width: 34, height: 34, bgcolor: isTelegram ? '#e0f2fe' : '#e2e8f0', color: isTelegram ? '#0284c7' : '#64748b', fontSize: 13, fontWeight: 600 }}>
          {isTelegram ? <SendIcon sx={{ fontSize: 18 }} /> : 'К'}
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
              {label}
            </Typography>
            {unread > 0 && (
              <Badge badgeContent={unread > 99 ? '99+' : unread} color="primary" sx={{ ml: 1 }} />
            )}
          </Box>
        }
        secondary={
          <Typography variant="caption" color="text.secondary" noWrap>
            {preview || elapsed}
          </Typography>
        }
      />
    </ListItemButton>
  );
}

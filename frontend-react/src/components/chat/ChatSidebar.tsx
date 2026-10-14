import { useState, useEffect, Fragment } from 'react';
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
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { formatElapsedTime } from '@/utils/format';

interface ChatSidebarProps {
  onSelectChat: (chatId: number) => void;
  currentChatId: number | null;
}

type Group = 'waiting' | 'distributed' | 'mine';

export default function ChatSidebar({ onSelectChat, currentChatId }: ChatSidebarProps) {
  const { chatTimers, chatUnread, chatPreviews, chatSources, chatNames, chatPublicCodes, chatAssignees } = useChatStore();
  const myId = useAuthStore((s) => s.user?.id ?? null);
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

  // Group assignments:
  // - waiting:     chat has no operator yet (anyone may pick it up);
  // - distributed: chat belongs to another operator (observer view);
  // - mine:        chat belongs to the current operator.
  const groups: Record<Group, number[]> = { waiting: [], distributed: [], mine: [] };
  for (const id of filtered) {
    const assignee = chatAssignees[String(id)];
    let g: Group = 'waiting';
    if (assignee) g = assignee.id === myId ? 'mine' : 'distributed';
    groups[g].push(id);
  }

  const groupMeta: { key: Group; title: string }[] = [
    { key: 'distributed', title: 'Распределённые' },
    { key: 'waiting', title: 'Ожидающие' },
    { key: 'mine', title: 'Мои' },
  ];

  return (
    <Box
      sx={{
        width: 280,
        bgcolor: 'background.paper',
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
        {groupMeta.map(({ key, title }) => {
          const ids = groups[key];
          if (ids.length === 0) return null;
          return (
            <Fragment key={key}>
              <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 0.5, fontWeight: 600, textTransform: 'uppercase', display: 'block' }}>
                {title}
              </Typography>
              {ids.map((id) => (
                <ChatItem
                  key={id}
                  chatId={id}
                  isActive={id === currentChatId}
                  group={key}
                  assignee={chatAssignees[String(id)]}
                  timer={chatTimers[String(id)]}
                  preview={chatPreviews[String(id)]}
                  source={chatSources[String(id)]}
                  name={chatNames[String(id)]}
                  publicCode={chatPublicCodes[String(id)]}
                  unread={chatUnread[String(id)] || 0}
                  now={now}
                  onClick={() => onSelectChat(id)}
                />
              ))}
            </Fragment>
          );
        })}

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
  group,
  assignee,
  timer,
  preview,
  source,
  name,
  publicCode,
  unread,
  now,
  onClick,
}: {
  chatId: number;
  isActive: boolean;
  group: Group;
  assignee?: { id: number; name: string };
  timer?: number;
  preview?: string;
  source?: string;
  name?: string;
  publicCode?: string;
  unread: number;
  now: number;
  onClick: () => void;
}) {
  const elapsed = timer ? formatElapsedTime(timer) : '...';
  const isTelegram = source === 'telegram';
  const label = name || (isTelegram ? 'Telegram' : 'Клиент');
  const code = publicCode || `#${chatId}`;
  // Keep the waiting counter ticking even when a preview is the latest line.
  void now;

  const isWaiting = group === 'waiting';
  const isObserver = group === 'distributed';
  // Left status stripe: palette tokens so it keeps contrast in both schemes.
  const stripeColor = isWaiting ? 'warning.main' : isObserver ? 'info.main' : isActive ? 'primary.main' : 'transparent';

  const secondaryLine = isObserver
    ? `Наблюдение · оператор ${assignee?.name || ''}`
    : preview || (timer ? 'Ожидание ответа' : 'Новый чат');

  return (
    <ListItemButton
      onClick={onClick}
      selected={isActive}
      sx={{
        borderLeft: '3px solid',
        borderLeftColor: stripeColor,
        bgcolor: isWaiting ? 'warnBg' : undefined,
        '&.Mui-selected': { bgcolor: 'action.selected' },
      }}
    >
      <ListItemAvatar>
        <Avatar sx={{ width: 34, height: 34, bgcolor: isTelegram ? 'infoBg' : 'action.hover', color: isTelegram ? 'info.main' : 'text.secondary', fontSize: 13, fontWeight: 600 }}>
          {isTelegram ? <SendIcon sx={{ fontSize: 18 }} /> : 'К'}
        </Avatar>
      </ListItemAvatar>
      <ListItemText
        primary={
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
              {label}
            </Typography>
            <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'text.secondary', flexShrink: 0 }}>
              {code}
            </Typography>
            {unread > 0 && (
              <Badge badgeContent={unread > 99 ? '99+' : unread} color="primary" sx={{ ml: 0.5 }} />
            )}
          </Box>
        }
        secondary={
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
            {isObserver ? (
              <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1, color: 'info.main', display: 'flex', alignItems: 'center', gap: 0.25 }}>
                <VisibilityIcon sx={{ fontSize: 11 }} />
                {secondaryLine}
              </Typography>
            ) : (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0, flex: 1 }}>
                {secondaryLine}
              </Typography>
            )}
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                flexShrink: 0,
                fontSize: 11,
                color: isWaiting ? 'warn' : 'text.secondary',
              }}
            >
              {elapsed}
            </Typography>
          </Box>
        }
      />
    </ListItemButton>
  );
}
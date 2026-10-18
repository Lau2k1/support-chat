import { useState, useEffect, Fragment } from 'react';
import { Box, TextField, InputAdornment, List, ListItemButton, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import SendIcon from '@mui/icons-material/Send';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { formatElapsedTime } from '@/utils/format';
import UserAvatar from '@/components/common/UserAvatar';
import UnreadBadge from '@/components/common/UnreadBadge';
import { chatLayout } from '@/theme';

interface ChatSidebarProps {
  onSelectChat: (chatId: number) => void;
  currentChatId: number | null;
}

type Group = 'waiting' | 'distributed' | 'mine';

const groupTitles: Record<Group, string> = {
  waiting: 'Ожидающие',
  distributed: 'Распределённые',
  mine: 'Мои',
};

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

  // Ищем по имени, публичному коду и превью последнего сообщения — по числовому
  // id фильтр не находил ничего, кроме самого id.
  const needle = search.trim().toLowerCase();
  const filtered = chatIds.filter((id) => {
    if (!needle) return true;
    return [chatNames[String(id)], chatPublicCodes[String(id)], chatPreviews[String(id)], String(id)]
      .some((field) => (field || '').toLowerCase().includes(needle));
  });

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

  const tabOrder: Group[] = ['distributed', 'waiting', 'mine'];

  return (
    <Box
      sx={{
        width: chatLayout.listWidth,
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      <Box sx={{ px: 1.25, pt: 1.25, pb: 1.25 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Поиск по имени, коду, сообщению…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>

      <List sx={{ flex: 1, overflowY: 'auto', p: 0, borderTop: '1px solid', borderColor: 'divider' }}>
        {tabOrder.map((key) => {
          const ids = groups[key];
          if (ids.length === 0) return null;
          return (
            <Fragment key={key}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ px: 2, pt: 1.25, pb: 0.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, display: 'block' }}
              >
                {groupTitles[key]}
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
            {needle ? 'Ничего не найдено' : 'Нет чатов'}
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
        alignItems: 'flex-start',
        gap: 1,
        py: 1.25,
        borderLeft: '3px solid',
        borderLeftColor: stripeColor,
        bgcolor: isWaiting ? 'warnBg' : undefined,
        '&.Mui-selected': { bgcolor: 'action.selected' },
      }}
    >
      <UserAvatar
        name={name}
        icon={isTelegram ? <SendIcon sx={{ fontSize: 18 }} /> : undefined}
        size={38}
        sx={{ mt: 0.25 }}
      />

      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}>
            {label}
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace', fontSize: 10, color: 'text.secondary', flexShrink: 0 }}>
            {code}
          </Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.25 }}>
          {isObserver ? (
            <Typography
              variant="caption"
              noWrap
              sx={{ minWidth: 0, flex: 1, color: 'info.main', display: 'flex', alignItems: 'center', gap: 0.25 }}
            >
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
          {unread > 0 && <UnreadBadge count={unread} sx={{ height: 18, minWidth: 18, fontSize: 10, px: 0.5 }} />}
        </Box>
      </Box>
    </ListItemButton>
  );
}

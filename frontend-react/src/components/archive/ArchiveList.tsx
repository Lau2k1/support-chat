import { Box, Typography, List, ListItemButton, ListItemText, Chip } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import type { Chat } from '@/types';
import { formatDateTime } from '@/utils/format';
import UserAvatar from '@/components/common/UserAvatar';
import { chatLayout } from '@/theme';

interface ArchiveListProps {
  chats: Chat[];
  selectedId: number | null;
  onSelect: (chatId: number) => void;
}

export default function ArchiveList({ chats, selectedId, onSelect }: ArchiveListProps) {
  return (
    <Box
      sx={{
        width: chatLayout.listWidth,
        flexShrink: 0,
        overflowY: 'auto',
        bgcolor: 'background.paper',
        borderRight: '1px solid',
        borderColor: 'divider',
      }}
    >
      {chats.length === 0 && (
        <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center', fontSize: 13 }}>
          Нет архивных чатов
        </Typography>
      )}
      <List sx={{ p: 0 }}>
        {chats.map((chat) => (
          <ListItemButton
            key={chat.id}
            selected={chat.id === selectedId}
            onClick={() => onSelect(chat.id)}
            sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', gap: 1.25 }}
          >
            <UserAvatar
              name={chat.client_name}
              icon={chat.source === 'telegram' ? <SendIcon sx={{ fontSize: 18 }} /> : undefined}
              size={36}
            />
            <ListItemText
              primary={
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {chat.client_name || 'Клиент'}
                  <Box component="span" sx={{ ml: 0.75, fontFamily: 'monospace', fontSize: 11, color: 'text.secondary' }}>
                    {chat.public_code || `#${chat.id}`}
                  </Box>
                </Typography>
              }
              secondary={
                <>
                  <Typography variant="caption" color="text.secondary">
                    {formatDateTime(chat.created_at)}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.3 }}>
                    {chat.tags.map((tag) => (
                      <Chip
                        key={tag.id}
                        label={tag.name}
                        size="small"
                        sx={{ height: 18, fontSize: 10, bgcolor: tag.color || 'primary.main', color: '#fff' }}
                      />
                    ))}
                  </Box>
                </>
              }
            />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

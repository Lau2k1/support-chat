import { Box, Typography, List, ListItemButton, ListItemAvatar, ListItemText, Avatar, Chip } from '@mui/material';
import type { Chat } from '@/types';
import { formatDateTime } from '@/utils/format';

interface ArchiveListProps {
  chats: Chat[];
  selectedId: number | null;
  onSelect: (chatId: number) => void;
}

export default function ArchiveList({ chats, selectedId, onSelect }: ArchiveListProps) {
  return (
    <Box
      sx={{
        width: 300,
        flexShrink: 0,
        overflowY: 'auto',
        bgcolor: '#fff',
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
            sx={{ borderBottom: '1px solid #f1f5f9' }}
          >
            <ListItemAvatar>
              <Avatar sx={{ width: 36, height: 36, bgcolor: '#e2e8f0', color: '#64748b', fontSize: 14, fontWeight: 600 }}>
                К
              </Avatar>
            </ListItemAvatar>
            <ListItemText
              primary={
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  Клиент #{chat.id}
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
                        sx={{ height: 18, fontSize: 10, bgcolor: tag.color || '#007bff', color: '#fff' }}
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

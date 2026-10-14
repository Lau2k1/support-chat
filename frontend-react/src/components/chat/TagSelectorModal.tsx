import {
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  TextField,
  Box,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import { useState } from 'react';
import { useChatStore } from '@/stores/chatStore';
import { chatApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';

interface TagSelectorProps {
  open: boolean;
  onClose: () => void;
  chatId: number | null;
}

export default function TagSelectorModal({ open, onClose, chatId }: TagSelectorProps) {
  const { allTags, chatTags, setChatTags } = useChatStore();
  const showToast = useUIStore((s) => s.showToast);
  const [search, setSearch] = useState('');

  const assignedIds = new Set((chatId ? chatTags[String(chatId)] : undefined)?.map((t) => t.id) || []);

  const filtered = allTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  /** Re-reads the chat's tags from the server so every view stays in sync. */
  const refresh = async (id: number) => {
    try {
      const res = await chatApi.getChatTags(id);
      setChatTags(String(id), res.data);
    } catch {
      /* keep the previous snapshot on failure */
    }
  };

  const handleToggle = async (tagId: number) => {
    if (!chatId) return;
    const isAssigned = assignedIds.has(tagId);
    try {
      if (isAssigned) {
        await chatApi.removeTag(chatId, tagId);
        showToast('Тег снят');
      } else {
        await chatApi.addTag(chatId, tagId);
        showToast('Тег назначен');
      }
      await refresh(chatId);
    } catch {
      showToast('Ошибка изменения тега', 'error');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Теги чата
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          size="small"
          placeholder="Поиск тегов..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1.5 }}
        />
        <List dense>
          {filtered.map((tag) => {
            const assigned = assignedIds.has(tag.id);
            return (
              <ListItemButton
                key={tag.id}
                onClick={() => handleToggle(tag.id)}
                sx={{
                  border: '1px solid',
                  borderColor: assigned ? 'primary.main' : 'divider',
                  bgcolor: assigned ? 'action.selected' : undefined,
                  borderRadius: 1,
                  mb: 0.5,
                }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: tag.color || 'primary.main' }} />
                </ListItemIcon>
                <ListItemText primary={tag.name} />
                {assigned && <CheckIcon fontSize="small" color="primary" />}
              </ListItemButton>
            );
          })}
          {filtered.length === 0 && (
            <ListItemText primary="Нет тегов" sx={{ color: 'text.secondary', textAlign: 'center' }} />
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}

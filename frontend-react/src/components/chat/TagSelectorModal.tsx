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
  const { allTags } = useChatStore();
  const showToast = useUIStore((s) => s.showToast);
  const [search, setSearch] = useState('');

  const filtered = allTags.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = async (tagId: number) => {
    if (!chatId) return;
    try {
      await chatApi.addTag(chatId, tagId);
      showToast('Тег назначен');
      onClose();
    } catch {
      showToast('Ошибка назначения тега', 'error');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Выбрать тег
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
          {filtered.map((tag) => (
            <ListItemButton key={tag.id} onClick={() => handleSelect(tag.id)} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 0.5 }}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: tag.color || '#007bff' }} />
              </ListItemIcon>
              <ListItemText primary={tag.name} />
            </ListItemButton>
          ))}
          {filtered.length === 0 && (
            <ListItemText primary="Нет тегов" sx={{ color: 'text.secondary', textAlign: 'center' }} />
          )}
        </List>
      </DialogContent>
    </Dialog>
  );
}

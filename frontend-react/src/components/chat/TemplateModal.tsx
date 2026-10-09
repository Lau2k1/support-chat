import { useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useChatStore } from '@/stores/chatStore';
import { cannedApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { CannedResponse } from '@/types';

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}

export default function TemplateModal({ open, onClose, onInsert }: TemplateModalProps) {
  const { cannedResponses, setCannedResponses } = useChatStore();
  const showToast = useUIStore((s) => s.showToast);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ shortcut: '', title: '', content: '' });

  const filtered = cannedResponses.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.shortcut.toLowerCase().includes(search.toLowerCase()) ||
      t.content.toLowerCase().includes(search.toLowerCase())
  );

  const loadCanned = async () => {
    try {
      const res = await cannedApi.getAll();
      setCannedResponses(res.data);
    } catch {
      showToast('Ошибка загрузки шаблонов', 'error');
    }
  };

  const handleSave = async () => {
    if (!form.shortcut || !form.title || !form.content) return;
    try {
      if (editing) {
        await cannedApi.update(editing.id, form);
      } else {
        await cannedApi.create(form);
      }
      await loadCanned();
      setFormOpen(false);
      setEditing(null);
      setForm({ shortcut: '', title: '', content: '' });
      showToast('Шаблон сохранён');
    } catch {
      showToast('Ошибка сохранения', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await cannedApi.delete(id);
      await loadCanned();
      showToast('Шаблон удалён');
    } catch {
      showToast('Ошибка удаления', 'error');
    }
  };

  const openForm = (item?: CannedResponse) => {
    if (item) {
      setEditing(item);
      setForm({ shortcut: item.shortcut, title: item.title, content: item.content });
    } else {
      setEditing(null);
      setForm({ shortcut: '', title: '', content: '' });
    }
    setFormOpen(true);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Шаблоны ответов
        <IconButton onClick={onClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          size="small"
          placeholder="Поиск..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 1.5 }}
        />

        <List dense>
          {filtered.map((t) => (
            <ListItemButton
              key={t.id}
              onClick={() => {
                onInsert(t.content);
                onClose();
              }}
              sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 0.5 }}
            >
              <ListItemText
                primary={
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{t.title}</Typography>
                    <Box>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); openForm(t); }}>
                        <EditIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}>
                        <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
                      </IconButton>
                    </Box>
                  </Box>
                }
                secondary={<><Typography variant="caption" color="text.secondary">/{t.shortcut}</Typography><br /><Typography variant="caption" color="text.secondary" noWrap>{t.content}</Typography></>}
              />
            </ListItemButton>
          ))}
          {filtered.length === 0 && (
            <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2, fontSize: 13 }}>
              Нет шаблонов
            </Typography>
          )}
        </List>

        {formOpen && (
          <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            <TextField fullWidth size="small" placeholder="Shortcut (hello)" value={form.shortcut} onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value }))} sx={{ mb: 1 }} />
            <TextField fullWidth size="small" placeholder="Название" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} sx={{ mb: 1 }} />
            <TextField fullWidth size="small" placeholder="Текст шаблона..." multiline rows={2} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} sx={{ mb: 1 }} />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" size="small" onClick={handleSave}>Сохранить</Button>
              <Button size="small" onClick={() => { setFormOpen(false); setEditing(null); }}>Отмена</Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<AddIcon />} onClick={() => openForm()} fullWidth variant="outlined" size="small">
          Новый шаблон
        </Button>
      </DialogActions>
    </Dialog>
  );
}

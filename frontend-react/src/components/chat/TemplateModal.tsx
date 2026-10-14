import { useState, Fragment } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  Chip,
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
import { LIMITS, validateShortcut, validateRequired, validateCategory } from '@/utils/validation';
import type { CannedResponse } from '@/types';

interface TemplateModalProps {
  open: boolean;
  onClose: () => void;
  onInsert: (content: string) => void;
}

const NO_CATEGORY = 'Без категории';
const labelOf = (c: string) => (c === '' ? NO_CATEGORY : c);

export default function TemplateModal({ open, onClose, onInsert }: TemplateModalProps) {
  const { cannedResponses, setCannedResponses } = useChatStore();
  const showToast = useUIStore((s) => s.showToast);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ category: '', shortcut: '', title: '', content: '' });

  const filtered = cannedResponses.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      t.shortcut.toLowerCase().includes(search.toLowerCase()) ||
      t.content.toLowerCase().includes(search.toLowerCase()) ||
      labelOf(t.category).toLowerCase().includes(search.toLowerCase())
  );

  // Categories keep their order (non-empty first, alphabetical; "Без категории" last).
  const categories = [...new Set(cannedResponses.map((r) => r.category || ''))].sort((a, b) => {
    const ae = a === '' ? 1 : 0;
    const be = b === '' ? 1 : 0;
    if (ae !== be) return ae - be;
    return a.localeCompare(b, 'ru');
  });

  const loadCanned = async () => {
    try {
      const res = await cannedApi.getAll();
      setCannedResponses(res.data);
    } catch {
      showToast('Ошибка загрузки быстрых ответов', 'error');
    }
  };

  const handleSave = async () => {
    const categoryErr = validateCategory(form.category);
    if (categoryErr) { showToast(categoryErr, 'error'); return; }
    if (form.shortcut.trim()) {
      const shortcutErr = validateShortcut(form.shortcut);
      if (shortcutErr) { showToast(shortcutErr, 'error'); return; }
    }
    const titleErr = validateRequired(form.title, 'Название', LIMITS.cannedTitle);
    if (titleErr) { showToast(titleErr, 'error'); return; }
    const contentErr = validateRequired(form.content, 'Текст', LIMITS.cannedContent);
    if (contentErr) { showToast(contentErr, 'error'); return; }
    try {
      const payload = {
        category: form.category.trim(),
        shortcut: form.shortcut.trim(),
        title: form.title.trim(),
        content: form.content,
      };
      if (editing) {
        await cannedApi.update(editing.id, payload);
      } else {
        await cannedApi.create(payload);
      }
      await loadCanned();
      setFormOpen(false);
      setEditing(null);
      setForm({ category: '', shortcut: '', title: '', content: '' });
      showToast('Ответ сохранён');
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка сохранения', 'error');
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await cannedApi.delete(id);
      await loadCanned();
      showToast('Ответ удалён');
    } catch {
      showToast('Ошибка удаления', 'error');
    }
  };

  const openForm = (item?: CannedResponse) => {
    if (item) {
      setEditing(item);
      setForm({ category: item.category, shortcut: item.shortcut, title: item.title, content: item.content });
    } else {
      setEditing(null);
      setForm({ category: '', shortcut: '', title: '', content: '' });
    }
    setFormOpen(true);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Быстрые ответы
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

        {categories.map((cat) => {
          const items = filtered.filter((t) => (t.category || '') === cat);
          if (items.length === 0) return null;
          return (
            <Fragment key={cat}>
              <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase', display: 'block', mt: 1, mb: 0.5 }} color="text.secondary">
                {labelOf(cat)}
              </Typography>
              <List dense>
                {items.map((t) => (
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
                      secondary={<><Typography variant="caption" color="text.secondary">{t.shortcut ? `/${t.shortcut}` : ''}</Typography><br /><Typography variant="caption" color="text.secondary" noWrap>{t.content}</Typography></>}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Fragment>
          );
        })}
        {filtered.length === 0 && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2, fontSize: 13 }}>
            Нет быстрых ответов
          </Typography>
        )}

        {formOpen && (
          <Box sx={{ mt: 2, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover' }}>
            <TextField
              fullWidth
              size="small"
              label="Категория"
              placeholder="Например: Здравствуйте, Ожидание, Завершение"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: LIMITS.cannedCategory } }}
              helperText="Группа, в которой ответ появится в меню"
              sx={{ mb: 1 }}
            />
            {categories.length > 0 && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1.5 }}>
                {categories.map((cat) => (
                  <Chip
                    key={cat}
                    label={labelOf(cat)}
                    size="small"
                    variant={form.category.trim() === cat ? 'filled' : 'outlined'}
                    onClick={() => setForm((f) => ({ ...f, category: cat }))}
                    sx={{ fontSize: 11, height: 22 }}
                  />
                ))}
              </Box>
            )}
            <TextField
              fullWidth
              size="small"
              label="Shortcut (необязательно)"
              placeholder="hello"
              value={form.shortcut}
              onChange={(e) => setForm((f) => ({ ...f, shortcut: e.target.value.replace(/^\//, '') }))}
              slotProps={{ htmlInput: { maxLength: LIMITS.cannedShortcut } }}
              helperText="Латиница, цифры, «_» и «-». Ввод /hello в чате подставит ответ"
              sx={{ mb: 1 }}
            />
            <TextField
              fullWidth
              size="small"
              label="Название"
              placeholder="Короткое название варианта"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: LIMITS.cannedTitle } }}
              sx={{ mb: 1 }}
            />
            <TextField
              fullWidth
              size="small"
              label="Текст ответа"
              placeholder="Текст, который вставится в сообщение..."
              multiline
              rows={2}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              slotProps={{ htmlInput: { maxLength: LIMITS.cannedContent } }}
              helperText={`${form.content.length}/${LIMITS.cannedContent}`}
              sx={{ mb: 1 }}
            />
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button variant="contained" size="small" onClick={handleSave}>{editing ? 'Сохранить' : 'Добавить'}</Button>
              <Button size="small" onClick={() => { setFormOpen(false); setEditing(null); }}>Отмена</Button>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button startIcon={<AddIcon />} onClick={() => openForm()} fullWidth variant="outlined" size="small">
          Новый ответ
        </Button>
      </DialogActions>
    </Dialog>
  );
}
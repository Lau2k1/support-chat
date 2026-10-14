import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { LIMITS, isHexColor, validateTagName } from '@/utils/validation';
import type { Tag } from '@/types';

export default function TagsPage({ tenantId }: { tenantId?: number } = {}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Tag | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#007bff');
  const [error, setError] = useState('');
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getTags(tenantId);
      setTags(res.data);
    } catch { showToast('Ошибка загрузки', 'error'); }
  }, [showToast, tenantId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setTagName('');
    setTagColor('#007bff');
    setError('');
    setModalOpen(true);
  };

  const openEdit = (tag: Tag) => {
    setEditing(tag);
    setTagName(tag.name);
    setTagColor(tag.color || '#007bff');
    setError('');
    setModalOpen(true);
  };

  const handleSave = async () => {
    const nameErr = validateTagName(tagName);
    if (nameErr) { setError(nameErr); return; }
    if (!isHexColor(tagColor)) { setError('Цвет: формат #RRGGBB'); return; }

    try {
      if (editing) {
        await adminApi.updateTag(editing.id, { name: tagName.trim(), color: tagColor });
        showToast('Тег обновлён');
      } else {
        await adminApi.createTag({ name: tagName.trim(), color: tagColor }, tenantId);
        showToast('Тег создан');
      }
      setModalOpen(false);
      setEditing(null);
      load();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Ошибка сохранения');
    }
  };

  const handleDelete = (id: number) => {
    showConfirm({
      text: 'Удалить тег?',
      danger: true,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        try {
          await adminApi.deleteTag(id);
          load();
          showToast('Тег удалён');
        } catch { showToast('Ошибка удаления', 'error'); }
      },
    });
  };

  return (
    <>
      <Paper sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Теги</Typography>
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={openCreate}>
            Создать тег
          </Button>
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <HeadCell>ID</HeadCell>
                <HeadCell>Название</HeadCell>
                <HeadCell>Цвет</HeadCell>
                <HeadCell>Действия</HeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tags.map((tag) => (
                <TableRow key={tag.id} hover>
                  <TableCell>{tag.id}</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>{tag.name}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: tag.color || '#007bff', border: '1px solid', borderColor: 'divider' }} />
                      <Typography variant="caption" color="text.secondary">{tag.color || '#007bff'}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                      <Button size="small" variant="outlined" startIcon={<EditIcon sx={{ fontSize: 15 }} />} onClick={() => openEdit(tag)}>
                        Изменить
                      </Button>
                      <Button size="small" variant="outlined" color="error" onClick={() => handleDelete(tag.id)}>
                        Удалить
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
              {tags.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    Тегов пока нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {editing ? 'Редактировать тег' : 'Создать тег'}
          <IconButton onClick={() => setModalOpen(false)} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Название"
            value={tagName}
            onChange={(e) => { setTagName(e.target.value); setError(''); }}
            error={!!error}
            helperText={`${tagName.length}/${LIMITS.tagName} символов`}
            slotProps={{ htmlInput: { maxLength: LIMITS.tagName } }}
            sx={{ mb: 2, mt: 1 }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField
              label="Цвет"
              type="color"
              value={tagColor}
              onChange={(e) => { setTagColor(e.target.value); setError(''); }}
              sx={{ width: 80 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: tagColor, border: '1px solid', borderColor: 'divider' }} />
          </Box>
          {error && <Typography color="error" variant="caption" sx={{ display: 'block', mt: 1 }}>{error}</Typography>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSave} disabled={!tagName.trim()}>{editing ? 'Сохранить' : 'Создать'}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function HeadCell({ children }: { children: React.ReactNode }) {
  return (
    <TableCell
      sx={{
        fontSize: 11,
        fontWeight: 600,
        color: 'text.secondary',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        bgcolor: 'action.hover',
      }}
    >
      {children}
    </TableCell>
  );
}

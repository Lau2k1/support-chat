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
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { Tag } from '@/types';

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState('#007bff');
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getTags();
      setTags(res.data);
    } catch { showToast('Ошибка загрузки', 'error'); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!tagName.trim()) { showToast('Введите название', 'error'); return; }
    try {
      await adminApi.createTag({ name: tagName.trim(), color: tagColor });
      setModalOpen(false);
      setTagName('');
      setTagColor('#007bff');
      load();
      showToast('Тег создан');
    } catch { showToast('Ошибка создания', 'error'); }
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
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => setModalOpen(true)}>
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
                      <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: tag.color || '#007bff', border: '1px solid #ccc' }} />
                      <Typography variant="caption" color="text.secondary">{tag.color || '#007bff'}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" color="error" onClick={() => handleDelete(tag.id)}>
                      Удалить
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Создать тег
          <IconButton onClick={() => setModalOpen(false)} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            label="Название"
            value={tagName}
            onChange={(e) => setTagName(e.target.value)}
            sx={{ mb: 2, mt: 1 }}
          />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <TextField
              label="Цвет"
              type="color"
              value={tagColor}
              onChange={(e) => setTagColor(e.target.value)}
              sx={{ width: 80 }}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Box sx={{ width: 32, height: 32, borderRadius: '50%', bgcolor: tagColor, border: '1px solid #ccc' }} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setModalOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={handleSave}>Сохранить</Button>
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
        bgcolor: '#f8fafc',
      }}
    >
      {children}
    </TableCell>
  );
}

import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { ticketTemplatesApi } from '@/services/endpoints';
import type { TicketTemplate } from '@/types';
import TicketTemplateBuilder from './TicketTemplateBuilder';
import { useUIStore } from '@/stores/uiStore';

export default function TicketTemplatesPage() {
  const showToast = useUIStore((s) => s.showToast);
  const [items, setItems] = useState<TicketTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<TicketTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<TicketTemplate | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ticketTemplatesApi.list();
      setItems(data.items || []);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось загрузить шаблоны', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = () => {
    setEditing(null);
    setBuilderOpen(true);
  };

  const handleEdit = (tpl: TicketTemplate) => {
    setEditing(tpl);
    setBuilderOpen(true);
  };

  const handleDuplicate = async (tpl: TicketTemplate) => {
    try {
      setSaving(true);
      await ticketTemplatesApi.create({
        name: `${tpl.name} (копия)`,
        description: tpl.description,
        schema: tpl.schema,
        isActive: false,
      });
      showToast('Шаблон скопирован (копия создана неактивной)');
      await load();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось скопировать шаблон', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (payload: {
    name: string;
    description: string | null;
    schema: any;
    isActive: boolean;
  }) => {
    setSaving(true);
    try {
      if (editing) {
        await ticketTemplatesApi.update(editing.id, payload);
        showToast('Шаблон обновлён');
      } else {
        await ticketTemplatesApi.create(payload);
        showToast('Шаблон создан');
      }
      setBuilderOpen(false);
      setEditing(null);
      await load();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось сохранить шаблон', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteId == null) return;
    setDeleting(true);
    try {
      await ticketTemplatesApi.delete(deleteId);
      showToast('Шаблон удалён');
      setDeleteId(null);
      await load();
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось удалить шаблон', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handlePreview = (tpl: TicketTemplate) => {
    setPreviewTpl(tpl);
    setPreviewOpen(true);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Шаблоны тикетов
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Конструктор форм тикетов. Создавать могут только админы, использовать — операторы.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>
          Создать шаблон
        </Button>
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell>Статус</TableCell>
                <TableCell>Полей</TableCell>
                <TableCell>Обновлён</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      Шаблоны ещё не созданы
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((tpl) => (
                  <TableRow key={tpl.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {tpl.name}
                      </Typography>
                      {tpl.description && (
                        <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25 }}>
                          {tpl.description}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {tpl.is_active ? (
                        <Chip label="Активен" color="success" size="small" />
                      ) : (
                        <Chip label="Неактивен" color="default" size="small" />
                      )}
                    </TableCell>
                    <TableCell>{tpl.schema?.fields?.length || 0}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(tpl.updated_at).toLocaleString('ru-RU')}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        <Tooltip title="Предпросмотр">
                          <IconButton size="small" onClick={() => handlePreview(tpl)}>
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Дублировать">
                          <IconButton size="small" onClick={() => handleDuplicate(tpl)} disabled={saving}>
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Редактировать">
                          <IconButton size="small" onClick={() => handleEdit(tpl)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Удалить">
                          <IconButton size="small" color="error" onClick={() => setDeleteId(tpl.id)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <TicketTemplateBuilder
        open={builderOpen}
        onClose={() => {
          setBuilderOpen(false);
          setEditing(null);
        }}
        template={editing}
        onSave={handleSave}
        saving={saving}
      />

      {/* Preview dialog */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Предпросмотр шаблона — {previewTpl?.name}</DialogTitle>
        <DialogContent dividers>
          {previewTpl?.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {previewTpl.description}
            </Typography>
          )}
          <Stack spacing={2}>
            {(previewTpl?.schema?.fields || []).map((f) => (
              <Box key={f.id}>
                {f.type === 'divider' ? (
                  <Divider />
                ) : f.type === 'title' ? (
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {f.label}
                  </Typography>
                ) : (
                  <Box>
                    <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
                      {f.label}
                      {f.required && <span style={{ color: 'red' }}> *</span>}
                    </Typography>
                    {f.helpText && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                        {f.helpText}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      [Тип: {f.type}]
                      {f.options?.length ? `, вариантов: ${f.options.length}` : ''}
                    </Typography>
                  </Box>
                )}
              </Box>
            ))}
            {(previewTpl?.schema?.fields?.length || 0) === 0 && (
              <Typography variant="body2" color="text.secondary">
                Поля отсутствуют
              </Typography>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteId != null} onClose={() => setDeleteId(null)}>
        <DialogTitle>Удалить шаблон?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Шаблон будет удалён безвозвратно. Операторы не смогут его использовать.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)} disabled={deleting}>
            Отмена
          </Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Удаление...' : 'Удалить'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

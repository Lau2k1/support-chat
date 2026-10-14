import { useEffect, useState } from 'react';
import {
  Box,
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
  Button,
  Divider,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { ticketTemplatesApi } from '@/services/endpoints';
import type { TicketTemplate } from '@/types';
import { useUIStore } from '@/stores/uiStore';

export default function TicketTemplatesList() {
  const showToast = useUIStore((s) => s.showToast);
  const [items, setItems] = useState<TicketTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<TicketTemplate | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await ticketTemplatesApi.list();
      // API для оператора возвращает только активные шаблоны
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

  const handlePreview = (tpl: TicketTemplate) => {
    setPreviewTpl(tpl);
    setPreviewOpen(true);
  };

  return (
    <Box sx={{ p: 3, height: '100%', overflowY: 'auto' }}>
      <Box sx={{ mb: 2.5 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Шаблоны тикетов
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Активные шаблоны, созданные администратором. Только просмотр.
        </Typography>
      </Box>

      <Card>
        <TableContainer>
          <Table size="medium">
            <TableHead>
              <TableRow>
                <TableCell>Название</TableCell>
                <TableCell>Описание</TableCell>
                <TableCell>Полей</TableCell>
                <TableCell align="right">Действия</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    Загрузка...
                  </TableCell>
                </TableRow>
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      Активных шаблонов нет
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
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {tpl.description || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={tpl.schema?.fields?.length || 0} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="Посмотреть">
                        <IconButton size="small" onClick={() => handlePreview(tpl)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Предпросмотр: {previewTpl?.name}</DialogTitle>
        <DialogContent dividers>
          {previewTpl?.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {previewTpl.description}
            </Typography>
          )}
          <Stack spacing={2}>
            {(previewTpl?.schema?.fields || []).map((f) => (
              <Box key={f.id}>
                {f.type === 'divider' ? <Divider /> : f.type === 'title' ? (
                  <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{f.label}</Typography>
                ) : (
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {f.label}{f.required && ' *'}
                    </Typography>
                    {f.helpText && (
                      <Typography variant="caption" color="text.secondary">{f.helpText}</Typography>
                    )}
                  </Box>
                )}
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPreviewOpen(false)}>Закрыть</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

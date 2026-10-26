import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  IconButton,
  InputLabel,
  Link,
  Menu,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ReplayIcon from '@mui/icons-material/Replay';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ticketsApi } from '@/services/endpoints';
import type { Ticket, TicketStatus } from '@/types';
import { useUIStore } from '@/stores/uiStore';
import CreateTicketDialog, { type CreateMode } from './CreateTicketDialog';
import {
  STATUS_LABELS,
  fileHref,
  fileValueOf,
  formatDateTime,
  ticketFieldRows,
  ticketSummary,
  isFreeTicket,
} from './ticketFormat';
import { PRIORITY_COLORS, PRIORITY_LABELS } from './templateLogic';

interface Props {
  /** Admins may delete tickets; operators may only create and resolve them. */
  isAdmin?: boolean;
}

type StatusFilter = 'all' | TicketStatus;

export default function TicketsPage({ isAdmin = false }: Props) {
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [createMode, setCreateMode] = useState<CreateMode | null>(null);
  const [createMenuAnchor, setCreateMenuAnchor] = useState<null | HTMLElement>(null);

  const [detail, setDetail] = useState<Ticket | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await ticketsApi.list(statusFilter === 'all' ? undefined : { status: statusFilter });
      setTickets(data.items || []);
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось загрузить тикеты', 'error');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreateMenu = (event: React.MouseEvent<HTMLElement>) => {
    setCreateMenuAnchor(event.currentTarget);
  };

  const pickCreateMode = (mode: CreateMode) => {
    setCreateMenuAnchor(null);
    setCreateMode(mode);
  };

  const applyStatus = async (ticket: Ticket, status: TicketStatus) => {
    setStatusBusy(true);
    try {
      const { data } = await ticketsApi.setStatus(ticket.id, status);
      setTickets((prev) => prev.map((t) => (t.id === data.ticket.id ? data.ticket : t)));
      setDetail((prev) => (prev && prev.id === data.ticket.id ? data.ticket : prev));
      showToast(status === 'resolved' ? 'Тикет отмечен решённым' : 'Тикет возвращён в работу');
    } catch (e: any) {
      showToast(e.response?.data?.error || 'Не удалось изменить статус', 'error');
    } finally {
      setStatusBusy(false);
    }
  };

  const handleDelete = (ticket: Ticket) => {
    showConfirm({
      text: `Удалить тикет #${ticket.id}? Действие необратимо.`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: async () => {
        try {
          await ticketsApi.remove(ticket.id);
          showToast('Тикет удалён');
          setDetailOpen(false);
          setDetail(null);
          await load();
        } catch (e: any) {
          showToast(e.response?.data?.error || 'Не удалось удалить тикет', 'error');
        }
      },
    });
  };

  const openDetail = (ticket: Ticket) => {
    setDetail(ticket);
    setDetailOpen(true);
  };

  const openCount = tickets.filter((t) => t.status === 'open').length;

  return (
    <Box sx={{ p: 3, height: '100%', overflowY: 'auto' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'center' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 2,
          mb: 2.5,
        }}
      >
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Тикеты
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Оформите тикет по шаблону администратора и отметьте его решённым, когда вопрос закрыт.
          </Typography>
        </Box>
        <Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            endIcon={<ExpandMoreIcon />}
            onClick={openCreateMenu}
          >
            Создать тикет
          </Button>
          <Menu
            anchorEl={createMenuAnchor}
            open={!!createMenuAnchor}
            onClose={() => setCreateMenuAnchor(null)}
          >
            <MenuItem onClick={() => pickCreateMode('template')}>Из шаблона</MenuItem>
            <MenuItem onClick={() => pickCreateMode('free')}>Свободный тикет</MenuItem>
          </Menu>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Статус</InputLabel>
          <Select
            label="Статус"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <MenuItem value="all">Все</MenuItem>
            <MenuItem value="open">Не решённые</MenuItem>
            <MenuItem value="resolved">Решённые</MenuItem>
          </Select>
        </FormControl>
        {!loading && (
          <Typography variant="body2" color="text.secondary">
            Всего: {tickets.length}
            {statusFilter !== 'resolved' ? ` • не решено: ${openCount}` : ''}
          </Typography>
        )}
      </Box>

      <Card>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 70 }}>№</TableCell>
                <TableCell>Тикет</TableCell>
                <TableCell sx={{ width: 120 }}>Приоритет</TableCell>
                <TableCell sx={{ width: 180 }}>Шаблон</TableCell>
                <TableCell sx={{ width: 120 }}>Статус</TableCell>
                <TableCell sx={{ width: 150 }}>Исполнитель</TableCell>
                <TableCell sx={{ width: 170 }}>Создан</TableCell>
                <TableCell align="right" sx={{ width: 90 }}>
                  Действия
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 4 }}>
                    <CircularProgress size={24} />
                  </TableCell>
                </TableRow>
              ) : tickets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
                      {statusFilter === 'all'
                        ? 'Тикетов пока нет. Нажмите «Создать тикет».'
                        : 'Тикетов с таким статусом нет.'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                tickets.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>{t.id}</TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {ticketSummary(t)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={PRIORITY_LABELS[t.priority] || PRIORITY_LABELS.normal}
                        color={PRIORITY_COLORS[t.priority] || 'default'}
                        variant={t.priority === 'high' ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {isFreeTicket(t) ? 'Свободный' : t.template_name}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {t.status === 'resolved' ? (
                        <Chip label={STATUS_LABELS.resolved} color="success" size="small" />
                      ) : (
                        <Chip label={STATUS_LABELS.open} color="warning" size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {t.assigned_to_name || t.created_by_name || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {formatDateTime(t.created_at)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                        <Tooltip title="Открыть">
                          <IconButton size="small" onClick={() => openDetail(t)}>
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {isAdmin && (
                          <Tooltip title="Удалить">
                            <IconButton size="small" color="error" onClick={() => handleDelete(t)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Card>

      {/* ---------- Create ticket (wizard) ---------- */}
      <CreateTicketDialog
        open={createMode !== null}
        mode={createMode || 'template'}
        onClose={() => setCreateMode(null)}
        onCreated={() => load()}
      />

      {/* ---------- Ticket detail ---------- */}
      <Dialog
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetail(null);
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Тикет #{detail?.id}</DialogTitle>
        <DialogContent dividers>
          {detail && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                {detail.status === 'resolved' ? (
                  <Chip label={STATUS_LABELS.resolved} color="success" size="small" />
                ) : (
                  <Chip label={STATUS_LABELS.open} color="warning" size="small" variant="outlined" />
                )}
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Приоритет: ${PRIORITY_LABELS[detail.priority] || PRIORITY_LABELS.normal}`}
                  color={PRIORITY_COLORS[detail.priority] || 'default'}
                />
                <Typography variant="caption" color="text.secondary">
                  {isFreeTicket(detail) ? `Тема: ${detail.template_name}` : `Шаблон: ${detail.template_name}`}
                </Typography>
                {detail.assigned_to_name && (
                  <Typography variant="caption" color="text.secondary">
                    Исполнитель: {detail.assigned_to_name}
                  </Typography>
                )}
              </Box>

              {ticketFieldRows(detail).map(({ field, value, raw }) => {
                const file = field.type === 'file' ? fileValueOf(raw) : null;
                return (
                  <Box key={field.id}>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {field.label}
                    </Typography>
                    {file ? (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <AttachFileIcon fontSize="small" color="action" />
                        <Link
                          href={fileHref(file)}
                          target="_blank"
                          rel="noopener"
                          variant="body2"
                          sx={{ wordBreak: 'break-all' }}
                        >
                          {file.name}
                        </Link>
                      </Box>
                    ) : (
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {value}
                      </Typography>
                    )}
                  </Box>
                );
              })}

              <Divider />
              <Typography variant="caption" color="text.secondary">
                Создан: {formatDateTime(detail.created_at)}
                {detail.created_by_name ? ` • ${detail.created_by_name}` : ''}
                {detail.status === 'resolved' && detail.resolved_at
                  ? ` • Решён: ${formatDateTime(detail.resolved_at)}${
                      detail.resolved_by_name ? ` (${detail.resolved_by_name})` : ''
                    }`
                  : ''}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
          <Box>
            {isAdmin && detail && (
              <Button color="error" startIcon={<DeleteIcon />} onClick={() => handleDelete(detail)}>
                Удалить
              </Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              onClick={() => {
                setDetailOpen(false);
                setDetail(null);
              }}
            >
              Закрыть
            </Button>
            {detail && detail.status === 'open' ? (
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                disabled={statusBusy}
                onClick={() => applyStatus(detail, 'resolved')}
              >
                Решено
              </Button>
            ) : detail ? (
              <Button
                variant="outlined"
                startIcon={<ReplayIcon />}
                disabled={statusBusy}
                onClick={() => applyStatus(detail, 'open')}
              >
                Вернуть в работу
              </Button>
            ) : null}
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

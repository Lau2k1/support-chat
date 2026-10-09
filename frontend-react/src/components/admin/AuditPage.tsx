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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { adminApi, chatApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { formatDateTime, formatTime } from '@/utils/format';
import type { AdminChat, Operator, Message } from '@/types';

export default function AuditPage() {
  const [chats, setChats] = useState<AdminChat[]>([]);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [status, setStatus] = useState('');
  const [operatorId, setOperatorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMessages, setModalMessages] = useState<Message[]>([]);
  const [modalChatId, setModalChatId] = useState<number | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const loadOps = async () => {
      try {
        const res = await adminApi.getOperators();
        setOperators(res.data);
      } catch { /* ignore */ }
    };
    loadOps();
  }, []);

  const load = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '100' };
      if (status) params.status = status;
      if (operatorId) params.operator_id = operatorId;
      if (from) params.from = from + 'T00:00:00';
      if (to) params.to = to + 'T23:59:59';
      const res = await adminApi.getChats(params);
      setChats(res.data);
    } catch { showToast('Ошибка загрузки', 'error'); }
  }, [status, operatorId, from, to, showToast]);

  useEffect(() => { load(); }, [load]);

  const handleViewMessages = async (chatId: number) => {
    setModalChatId(chatId);
    setModalOpen(true);
    setModalLoading(true);
    setModalMessages([]);
    try {
      const res = await chatApi.getMessages(chatId);
      setModalMessages(res.data);
    } catch { showToast('Ошибка загрузки сообщений', 'error'); }
    finally { setModalLoading(false); }
  };

  return (
    <>
      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15, mb: 2 }}>Аудит чатов</Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Статус</InputLabel>
            <Select value={status} label="Статус" onChange={(e) => setStatus(e.target.value)}>
              <MenuItem value="">Все</MenuItem>
              <MenuItem value="open">Открытые</MenuItem>
              <MenuItem value="closed">Закрытые</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel>Оператор</InputLabel>
            <Select value={operatorId} label="Оператор" onChange={(e) => setOperatorId(e.target.value)}>
              <MenuItem value="">Все операторы</MenuItem>
              {operators.map((op) => (
                <MenuItem key={op.id} value={String(op.id)}>{op.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField size="small" type="date" label="С" value={from} onChange={(e) => setFrom(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField size="small" type="date" label="По" value={to} onChange={(e) => setTo(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
        </Box>

        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <HeadCell>ID</HeadCell>
                <HeadCell>Клиент</HeadCell>
                <HeadCell>Оператор</HeadCell>
                <HeadCell>Статус</HeadCell>
                <HeadCell>Рейтинг</HeadCell>
                <HeadCell>Сообщений</HeadCell>
                <HeadCell>Создан</HeadCell>
                <HeadCell>Действия</HeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {chats.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                    Нет чатов
                  </TableCell>
                </TableRow>
              )}
              {chats.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell>#{c.id}</TableCell>
                  <TableCell>Клиент #{c.client_id}</TableCell>
                  <TableCell>{c.operator_name || <Box component="span" color="text.secondary">Не назначен</Box>}</TableCell>
                  <TableCell>
                    <Chip
                      label={c.status === 'open' ? 'Открыт' : 'Закрыт'}
                      size="small"
                      sx={{
                        bgcolor: c.status === 'open' ? '#dbeafe' : '#f1f5f9',
                        color: c.status === 'open' ? '#1d4ed8' : '#64748b',
                        fontWeight: 600,
                        fontSize: 11,
                      }}
                    />
                  </TableCell>
                  <TableCell>{c.rating ? `${c.rating} ★` : '—'}</TableCell>
                  <TableCell>{c.messages_count}</TableCell>
                  <TableCell>{formatDateTime(c.created_at)}</TableCell>
                  <TableCell>
                    <Button size="small" variant="outlined" onClick={() => handleViewMessages(c.id)}>
                      Просмотр
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog open={modalOpen} onClose={() => setModalOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          Чат #{modalChatId}
          <IconButton onClick={() => setModalOpen(false)} size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent>
          {modalLoading ? (
            <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Загрузка...</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, maxHeight: 400, overflowY: 'auto', p: 1, bgcolor: '#fdfdfd', borderRadius: 1, border: '1px solid #f1f5f9' }}>
              {modalMessages.map((m) => {
                const isNote = m.message_type === 'note';
                const isClient = m.sender_id === 0;
                return (
                  <Box
                    key={m.id}
                    sx={{
                      maxWidth: '80%',
                      alignSelf: isNote ? 'center' : isClient ? 'flex-start' : 'flex-end',
                      px: 1.2,
                      py: 0.8,
                      borderRadius: 1.5,
                      fontSize: 13,
                      bgcolor: isNote ? '#fef9c3' : isClient ? '#fff' : 'primary.main',
                      color: isNote ? '#713f12' : isClient ? 'text.primary' : '#fff',
                      border: isNote ? '1px dashed #eab308' : isClient ? '1px solid #e2e8f0' : 'none',
                    }}
                  >
                    {isNote && '📝 '}{m.content}
                    {!isNote && (
                      <Typography variant="caption" sx={{ display: 'block', textAlign: 'right', opacity: 0.6, mt: 0.3 }}>
                        {formatTime(m.created_at)}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}
        </DialogContent>
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

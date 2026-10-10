import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { TelegramBot } from '@/types';

export default function CrmBotsPage() {
  const [bots, setBots] = useState<TelegramBot[]>([]);
  const [loading, setLoading] = useState(true);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await superadminApi.getTelegramBots();
        setBots(res.data);
      } catch {
        showToast('Ошибка загрузки ботов', 'error');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [showToast]);

  if (loading) return <Typography color="text.secondary">Загрузка...</Typography>;

  return (
    <Paper sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <SendIcon color="primary" fontSize="small" />
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Telegram-боты клиентов</Typography>
      </Box>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <HeadCell>Клиент</HeadCell>
              <HeadCell>Бот</HeadCell>
              <HeadCell>Статус</HeadCell>
              <HeadCell>Подключён</HeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {bots.map((b) => (
              <TableRow key={b.id} hover>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{b.tenant_name}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{b.tenant_slug}</Typography>
                </TableCell>
                <TableCell>{b.bot_username ? `@${b.bot_username}` : '—'}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={b.is_active ? 'Активен' : 'Выключен'}
                    color={b.is_active ? 'success' : 'default'}
                  />
                </TableCell>
                <TableCell>{b.created_at ? new Date(b.created_at).toLocaleDateString() : '—'}</TableCell>
              </TableRow>
            ))}
            {!bots.length && (
              <TableRow>
                <TableCell colSpan={4} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                  Ни один клиент ещё не подключил бота
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
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

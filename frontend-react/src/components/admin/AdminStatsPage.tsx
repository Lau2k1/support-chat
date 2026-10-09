import { useState, useEffect } from 'react';
import { Box, Typography, Card, Grid, Paper, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { adminApi } from '@/services/endpoints';
import type { OperatorStats } from '@/types';

export default function AdminStatsPage() {
  const [stats, setStats] = useState<OperatorStats[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi.getOperatorStats();
        setStats(res.data);
      } catch { /* ignore */ }
    };
    load();
  }, []);

  const totalChats = stats.reduce((s, o) => s + Number(o.total_chats), 0);
  const totalMsgs = stats.reduce((s, o) => s + Number(o.total_messages), 0);
  const avgResp = stats.length ? Math.round(stats.reduce((s, o) => s + Number(o.avg_response_sec), 0) / stats.length) : 0;
  const avgRating = stats.length ? Math.round(stats.reduce((s, o) => s + Number(o.avg_rating), 0) / stats.length * 10) / 10 : 0;

  const cards = [
    { value: stats.length, label: 'Операторов' },
    { value: totalChats, label: 'Всего чатов' },
    { value: totalMsgs, label: 'Всего сообщений' },
    { value: `${avgResp}с`, label: 'Ср. время ответа' },
    { value: avgRating || '—', label: 'Ср. рейтинг' },
  ];

  const maxChats = Math.max(...stats.map((o) => Number(o.total_chats)), 1);

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((c) => (
          <Grid size={{ xs: 6, sm: 4, md: 2 }} key={c.label}>
            <Card sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 700 }} color="primary">{c.value}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {c.label}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 2 }}>Чаты по операторам</Typography>
        {stats.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>Нет данных</Typography>
        ) : (
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 140, pt: 2 }}>
            {stats.map((o) => (
              <Box key={o.id} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>{o.total_chats}</Typography>
                <Box
                  sx={{
                    width: '100%',
                    bgcolor: 'primary.main',
                    borderRadius: '4px 4px 0 0',
                    minHeight: 2,
                    height: `${(Number(o.total_chats) / maxChats) * 100}%`,
                    transition: 'height 0.3s',
                  }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 80 }}>
                  {o.name}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Paper>

      <Paper sx={{ p: 2.5 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 2 }}>Детальная статистика</Typography>
        <Table size="small">
          <TableHead>
            <TableRow>
              <StatHeadCell>Оператор</StatHeadCell>
              <StatHeadCell>Чатов</StatHeadCell>
              <StatHeadCell>Сообщений</StatHeadCell>
              <StatHeadCell>Ср. время ответа</StatHeadCell>
              <StatHeadCell>Ср. рейтинг</StatHeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {stats.map((o) => (
              <TableRow key={o.id} hover>
                <TableCell>
                  {o.name} <Box component="span" color="text.secondary" sx={{ fontSize: 11 }}>{o.email}</Box>
                </TableCell>
                <TableCell>{o.total_chats}</TableCell>
                <TableCell>{o.total_messages}</TableCell>
                <TableCell>{o.avg_response_sec}с</TableCell>
                <TableCell>{o.avg_rating > 0 ? `${o.avg_rating} ★` : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
    </Box>
  );
}

function StatHeadCell({ children }: { children: React.ReactNode }) {
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

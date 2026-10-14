import { useState, useEffect } from 'react';
import { Box, Typography, Card, Grid, Paper, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { adminApi } from '@/services/endpoints';
import type { OperatorStats } from '@/types';
import { formatDuration } from '@/utils/format';

export default function AdminStatsPage({ tenantId }: { tenantId?: number } = {}) {
  const [stats, setStats] = useState<OperatorStats[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await adminApi.getOperatorStats(tenantId);
        setStats(res.data);
      } catch { /* ignore */ }
    };
    load();
  }, [tenantId]);

  const totalChats = stats.reduce((s, o) => s + Number(o.total_chats), 0);
  const totalMsgs = stats.reduce((s, o) => s + Number(o.total_messages), 0);
  const avgResp = stats.length ? Math.round(stats.reduce((s, o) => s + Number(o.avg_response_sec), 0) / stats.length) : 0;
  const avgRating = stats.length ? Math.round(stats.reduce((s, o) => s + Number(o.avg_rating), 0) / stats.length * 10) / 10 : 0;

  const cards = [
    { value: stats.length, label: 'Операторов' },
    { value: totalChats, label: 'Всего чатов' },
    { value: totalMsgs, label: 'Всего сообщений' },
    { value: formatDuration(avgResp), label: 'Ср. ответ' },
    { value: avgRating || '—', label: 'Ср. рейтинг' },
  ];

  const maxChats = Math.max(...stats.map((o) => Number(o.total_chats)), 1);

  return (
    <Box>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((c) => (
          <Grid size={{ xs: 6, sm: 4, md: 2 }} key={c.label}>
            <Card
              sx={{
                p: 2,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' }} color="primary">{c.value}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25, mt: 0.25 }}>
                {c.label}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Paper sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 2, mb: 2 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 14 }}>Чаты по операторам</Typography>
          <Typography variant="body2" color="text.secondary">
            Всего: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{totalChats}</Box>
          </Typography>
        </Box>
        {stats.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>Нет данных</Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 0.5 }}>
            {stats.map((o) => {
              const pct = Math.round((Number(o.total_chats) / maxChats) * 100);
              return (
                <Box key={o.id} sx={{ flex: '1 0 76px', minWidth: 76 }}>
                  {/* Колонка фиксированной высоты — иначе `height: %` у столбика
                      считается от auto-родителя и схлопывается. */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 160 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, lineHeight: 1.3 }}>{o.total_chats}</Typography>
                    <Box sx={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Box
                        title={`${o.name}: ${o.total_chats}`}
                        sx={{
                          width: '58%',
                          maxWidth: 40,
                          minHeight: 3,
                          height: `${pct}%`,
                          borderRadius: '6px 6px 0 0',
                          background: 'linear-gradient(180deg, #63b3ff 0%, #007bff 100%)',
                          transition: 'height .3s ease, filter .2s ease',
                          '&:hover': { filter: 'brightness(1.12)' },
                        }}
                      />
                    </Box>
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', textAlign: 'center', mt: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {o.name}
                  </Typography>
                </Box>
              );
            })}
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
                <TableCell>{formatDuration(o.avg_response_sec)}</TableCell>
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

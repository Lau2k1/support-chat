import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
} from '@mui/material';
import { useEffect } from 'react';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { CrmDashboard, Tenant } from '@/types';

export default function CrmOverviewPage() {
  const [dash, setDash] = useState<CrmDashboard | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const load = async () => {
      try {
        const [d, t] = await Promise.all([superadminApi.getDashboard(), superadminApi.getTenants()]);
        setDash({
          ...d.data,
          avg_rating: Math.round(Number(d.data.avg_rating) * 10) / 10,
        });
        setTenants(t.data);
      } catch {
        showToast('Ошибка загрузки метрик', 'error');
      }
    };
    load();
  }, [showToast]);

  if (!dash) return <Box sx={{ p: 3, textAlign: 'center' }}>Загрузка...</Box>;

  const cards = [
    { value: dash.tenants, label: 'Тенантов' },
    { value: dash.active_tenants, label: 'Активных' },
    { value: dash.operators, label: 'Операторов' },
    { value: dash.open_chats, label: 'Открытых чатов' },
    { value: dash.chats, label: 'Всего чатов' },
    { value: dash.messages, label: 'Сообщений' },
    { value: `${dash.invites_used}/${dash.invites}`, label: 'Инвайтов исп./выдано' },
    { value: dash.avg_rating || '—', label: 'Ср. рейтинг' },
  ];

  const maxCount = Math.max(...dash.daily.map((d) => d.count), 1);

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
        Обзор платформы
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((c) => (
          <Grid size={{ xs: 6, sm: 4, md: 3 }} key={c.label}>
            <Card sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="h5" sx={{ fontWeight: 700 }} color="primary">{c.value}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {c.label}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ p: 2.5, mb: 3 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          Чаты за последние 7 дней (все тенанты)
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 140, pt: 2 }}>
          {dash.daily.map((d) => (
            <Box key={d.day} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{d.count}</Typography>
              <Box
                sx={{
                  width: '100%',
                  bgcolor: 'primary.main',
                  borderRadius: '4px 4px 0 0',
                  minHeight: 2,
                  height: `${(d.count / maxCount) * 100}%`,
                  transition: 'height 0.3s',
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>{d.day.split('-').slice(1).join('.')}</Typography>
            </Box>
          ))}
        </Box>
      </Card>

      <Paper sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
          <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Клиенты (тенанты)</Typography>
          <Button component={Link} to="/crm?view=tenants" size="small" variant="outlined">
            Управлять
          </Button>
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <HeadCell>Клиент</HeadCell>
                <HeadCell>Статус</HeadCell>
                <HeadCell>Операторы</HeadCell>
                <HeadCell>Чаты</HeadCell>
                <HeadCell>Ср. рейтинг</HeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenants.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>{t.name}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>{t.slug}</Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={t.status === 'active' ? 'Активен' : 'Приостановлен'}
                      color={t.status === 'active' ? 'success' : 'error'}
                    />
                  </TableCell>
                  <TableCell>{t.operators_count ?? 0}</TableCell>
                  <TableCell>{t.chats_count ?? 0}</TableCell>
                  <TableCell>{t.avg_rating ? `${t.avg_rating} ★` : '—'}</TableCell>
                </TableRow>
              ))}
              {!tenants.length && (
                <TableRow>
                  <TableCell colSpan={5} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                    Тенантов пока нет
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </Box>
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
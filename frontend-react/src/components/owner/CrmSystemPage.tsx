import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';
import MemoryIcon from '@mui/icons-material/Memory';
import SendIcon from '@mui/icons-material/Send';
import LockIcon from '@mui/icons-material/Lock';
import { superadminApi } from '@/services/endpoints';
import type { CheckLevel, StatusCheck, SystemAlert, SystemStatus } from '@/types';
import { useUIStore } from '@/stores/uiStore';

const LEVEL_COLOR: Record<CheckLevel, string> = {
  ok: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

const ICONS: Record<string, React.ReactNode> = {
  health: <DnsIcon fontSize="small" />,
  database: <StorageIcon fontSize="small" />,
  disk: <StorageIcon fontSize="small" />,
  memory: <MemoryIcon fontSize="small" />,
  telegram: <SendIcon fontSize="small" />,
  tls: <LockIcon fontSize="small" />,
};

function levelLabel(level: CheckLevel): string {
  if (level === 'ok') return 'Работает';
  if (level === 'warning') return 'Внимание';
  return 'Сбой';
}

function uptimeText(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${m} мин`;
  return `${m} мин`;
}

export default function CrmSystemPage() {
  const showToast = useUIStore((s) => s.showToast);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setLoading(true);
      try {
        const [statusRes, alertsRes] = await Promise.all([
          superadminApi.getSystemStatus(),
          superadminApi.getSystemAlerts(50),
        ]);
        setStatus(statusRes.data);
        setAlerts(alertsRes.data.items || []);
        setRefreshedAt(new Date());
      } catch (e: any) {
        showToast(e?.response?.data?.error || 'Не удалось получить состояние сервера', 'error');
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  useEffect(() => {
    load(true);
    // The endpoint is cached server-side (30 s), so this poll is cheap.
    const timer = setInterval(() => load(false), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const openAlerts = alerts.filter((a) => a.status === 'firing').length;

  return (
    <Box>
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
            Состояние сервера
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Проверки выполняются автоматически каждые 5 минут. При сбое и восстановлении владелец получает сообщение
            в Telegram.
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {refreshedAt && (
            <Typography variant="caption" color="text.secondary">
              Обновлено: {refreshedAt.toLocaleTimeString('ru-RU')}
            </Typography>
          )}
          <Tooltip title="Обновить">
            <IconButton size="small" onClick={() => load(false)}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {loading && !status ? (
        <Box sx={{ textAlign: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <>
          <Grid container spacing={2} sx={{ mb: 3 }}>
            {(status?.checks || []).map((c: StatusCheck) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={c.key}>
                <Card
                  sx={{
                    p: 2,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    borderLeft: '4px solid',
                    borderColor: LEVEL_COLOR[c.level],
                  }}
                >
                  <Box sx={{ color: LEVEL_COLOR[c.level], display: 'flex' }}>{ICONS[c.key] || <DnsIcon fontSize="small" />}</Box>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {c.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {c.value}
                    </Typography>
                    {c.detail && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ opacity: 0.8 }}>
                        {c.detail}
                      </Typography>
                    )}
                  </Box>
                  <Chip
                    size="small"
                    label={levelLabel(c.level)}
                    sx={{
                      bgcolor: `${LEVEL_COLOR[c.level]}1a`,
                      color: LEVEL_COLOR[c.level],
                      fontWeight: 600,
                    }}
                  />
                </Card>
              </Grid>
            ))}
          </Grid>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            {status && (
              <Chip
                size="small"
                icon={status.ok ? <CheckCircleIcon /> : <ErrorIcon />}
                label={status.ok ? 'Всё в норме' : `Проблемы: ${status.failing.length}`}
                color={status.ok ? 'success' : 'error'}
                variant={status.ok ? 'outlined' : 'filled'}
              />
            )}
            <Chip size="small" variant="outlined" label={`Uptime приложения: ${uptimeText(status?.uptimeSec || 0)}`} />
            <Chip
              size="small"
              variant="outlined"
              color={openAlerts > 0 ? 'error' : 'default'}
              icon={openAlerts > 0 ? <WarningAmberIcon /> : undefined}
              label={openAlerts > 0 ? `Активных алертов: ${openAlerts}` : 'Активных алертов нет'}
            />
          </Box>

          <Paper sx={{ p: 2.5 }}>
            <Typography sx={{ fontWeight: 600, fontSize: 14, mb: 2 }}>Журнал алертов</Typography>
            {alerts.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                Алертов не было — система работала без сбоев.
              </Typography>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', bgcolor: 'action.hover' }}>
                      ВРЕМЯ
                    </TableCell>
                    <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', bgcolor: 'action.hover' }}>
                      СОСТОЯНИЕ
                    </TableCell>
                    <TableCell sx={{ fontSize: 11, fontWeight: 600, color: 'text.secondary', bgcolor: 'action.hover' }}>
                      СООБЩЕНИЕ
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {alerts.map((a) => (
                    <TableRow key={a.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {new Date(a.created_at).toLocaleString('ru-RU')}
                      </TableCell>
                      <TableCell>
                        {a.status === 'resolved' ? (
                          <Chip label="Восстановлено" color="success" size="small" variant="outlined" />
                        ) : a.severity === 'critical' ? (
                          <Chip label="Сбой" color="error" size="small" />
                        ) : (
                          <Chip label="Внимание" color="warning" size="small" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">{a.message}</Typography>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paper>

          <Box sx={{ mt: 2 }}>
            <Button size="small" onClick={() => load(true)}>
              Обновить сейчас
            </Button>
          </Box>
        </>
      )}
    </Box>
  );
}

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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { adminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { formatDateTime } from '@/utils/format';
import type { InviteCode } from '@/types';

export default function InvitesPage() {
  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [expiry, setExpiry] = useState('0');
  const [createdCodes, setCreatedCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const showConfirm = useUIStore((s) => s.showConfirm);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await adminApi.getInvites();
      setInvites(res.data);
    } catch { showToast('Ошибка загрузки', 'error'); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setBusy(true);
    try {
      const res = await adminApi.createInvite(Number(expiry) || undefined);
      setCreatedCodes(res.data.codes);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка создания', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCloseCodes = () => {
    setCreatedCodes(null);
    load();
  };

  const handleDelete = (id: number) => {
    showConfirm({
      text: 'Удалить инвайт-код?',
      danger: true,
      confirmLabel: 'Удалить',
      onConfirm: async () => {
        try {
          await adminApi.deleteInvite(id);
          load();
          showToast('Удалено');
        } catch { showToast('Ошибка удаления', 'error'); }
      },
    });
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => showToast('Скопировано!'),
      () => {}
    );
  };

  return (
    <Paper sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ fontWeight: 600, fontSize: 15 }}>Инвайт-коды</Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Срок</InputLabel>
            <Select value={expiry} label="Срок" onChange={(e) => setExpiry(e.target.value)}>
              <MenuItem value="0">Без срока</MenuItem>
              <MenuItem value="24">24 часа</MenuItem>
              <MenuItem value="48">48 часов</MenuItem>
              <MenuItem value="168">7 дней</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained" onClick={handleGenerate} disabled={busy}>Сгенерировать</Button>
        </Box>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <HeadCell>Код</HeadCell>
              <HeadCell>Создан</HeadCell>
              <HeadCell>Истекает</HeadCell>
              <HeadCell>Использован</HeadCell>
              <HeadCell>Действия</HeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {invites.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 4 }}>
                  Нет инвайт-кодов
                </TableCell>
              </TableRow>
            )}
            {invites.map((inv) => {
              const isUsed = !!inv.used_by_name;
              const isExpired = !isUsed && !!inv.expires_at && new Date(inv.expires_at) < new Date();
              return (
                <TableRow key={inv.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        component="span"
                        sx={{
                          fontFamily: 'monospace',
                          fontWeight: 600,
                          fontSize: 14,
                          letterSpacing: 1,
                          color: 'primary.main',
                          bgcolor: '#f0f4ff',
                          px: 1,
                          borderRadius: 0.5,
                        }}
                      >
                        {inv.code}
                      </Box>
                      {!isUsed && (
                        <Button size="small" variant="outlined" startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />} onClick={() => handleCopy(inv.code)}>
                          Копировать
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell>{formatDateTime(inv.created_at)}</TableCell>
                  <TableCell>
                    {inv.expires_at ? formatDateTime(inv.expires_at) : '—'}
                    {isExpired && <Box component="span" color="error" sx={{ ml: 1, fontSize: 12 }}>Истёк</Box>}
                  </TableCell>
                  <TableCell>
                    {isUsed ? `${inv.used_by_name} (${inv.used_at ? formatDateTime(inv.used_at) : ''})` : '—'}
                  </TableCell>
                  <TableCell>
                    {!isUsed && (
                      <Button size="small" variant="outlined" color="error" onClick={() => handleDelete(inv.id)}>
                        Удалить
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={!!createdCodes} onClose={handleCloseCodes} maxWidth="sm" fullWidth>
        <DialogTitle>Инвайт-коды созданы</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Выдайте эти коды операторам — они зарегистрируются по ссылке «Регистрация по инвайт-коду».
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {createdCodes?.map((code) => (
              <Box key={code} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  component="span"
                  sx={{
                    flex: 1,
                    fontFamily: 'monospace',
                    fontWeight: 600,
                    fontSize: 15,
                    letterSpacing: 1.5,
                    color: 'primary.main',
                    bgcolor: '#f0f4ff',
                    px: 1.5,
                    py: 0.8,
                    borderRadius: 1,
                  }}
                >
                  {code}
                </Box>
                <Button size="small" variant="outlined" startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />} onClick={() => handleCopy(code)}>
                  Копировать
                </Button>
              </Box>
            ))}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCodes}>Закрыть</Button>
        </DialogActions>
      </Dialog>
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

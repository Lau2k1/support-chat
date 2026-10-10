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
  Chip,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { Tenant } from '@/types';

export default function CrmTenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  // Invite issuance dialog
  const [issueTenant, setIssueTenant] = useState<Tenant | null>(null);
  const [issueCount, setIssueCount] = useState(5);
  const [issuedCodes, setIssuedCodes] = useState<string[] | null>(null);

  // Seat limit dialog
  const [limitTenant, setLimitTenant] = useState<Tenant | null>(null);
  const [limitValue, setLimitValue] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await superadminApi.getTenants();
      setTenants(res.data);
    } catch {
      showToast('Ошибка загрузки тенантов', 'error');
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim() || !slug.trim()) { showToast('Укажите имя и slug', 'error'); return; }
    setBusy(true);
    try {
      await superadminApi.createTenant({ name: name.trim(), slug: slug.trim() });
      showToast('Тенант создан');
      setName('');
      setSlug('');
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка создания', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleToggleStatus = (t: Tenant) => {
    const next = t.status === 'active' ? 'suspended' : 'active';
    const action = next === 'suspended' ? 'Приостановить' : 'Активировать';
    showConfirm({
      text: `${action} тенант «${t.name}»?`,
      onConfirm: async () => {
        try {
          await superadminApi.setTenantStatus(t.id, next);
          showToast('Обновлено');
          load();
        } catch { showToast('Ошибка', 'error'); }
      },
    });
  };

  const handleOpenIssue = (t: Tenant) => {
    setIssuedCodes(null);
    setIssueCount(5);
    setIssueTenant(t);
  };

  const handleIssue = async () => {
    if (!issueTenant) return;
    try {
      const res = await superadminApi.issueInvites(issueTenant.id, { count: issueCount });
      setIssuedCodes(res.data.codes);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка выдачи', 'error');
    }
  };

  const handleOpenLimit = (t: Tenant) => {
    setLimitValue(t.operator_limit === null || t.operator_limit === undefined ? '' : String(t.operator_limit));
    setLimitTenant(t);
  };

  const handleSaveLimit = async () => {
    if (!limitTenant) return;
    setBusy(true);
    try {
      const limit = limitValue === '' ? null : Number(limitValue);
      if (limit !== null && (!Number.isInteger(limit) || limit < 0)) {
        showToast('Лимит — неотрицательное целое число или пусто (без лимита)', 'error');
        return;
      }
      await superadminApi.updateTenant(limitTenant.id, { operator_limit: limit });
      showToast('Лимит мест обновлён');
      setLimitTenant(null);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code).then(
      () => showToast('Скопировано!'),
      () => {}
    );
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
        Клиенты — тенанты и места
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        «Лимит мест» — сколько операторов + неиспользованных инвайтов разрешено тенанту. Выдача инвайтов создаёт
        коды, которые вы передаёте клиенту.
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
        <TextField
          size="small"
          label="Название"
          value={name}
          onChange={(e) => setName(e.target.value)}
          sx={{ width: 260 }}
        />
        <TextField
          size="small"
          label="slug (для виджета: data-tenant)"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          helperText="латиница, цифры, дефис"
          sx={{ width: 300 }}
        />
        <Button variant="contained" onClick={handleCreate} disabled={busy}>
          Добавить клиента
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <HeadCell>Клиент</HeadCell>
              <HeadCell>Статус</HeadCell>
              <HeadCell>Лимит мест</HeadCell>
              <HeadCell>Операторы</HeadCell>
              <HeadCell>Чаты / открыто</HeadCell>
              <HeadCell>Инвайты исп.</HeadCell>
              <HeadCell>Действия</HeadCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t.id} hover>
                <TableCell>
                  <Typography sx={{ fontWeight: 600 }}>{t.name}</Typography>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                    {t.slug} (#{t.id})
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t.status === 'active' ? 'Активен' : 'Приостановлен'}
                    color={t.status === 'active' ? 'success' : 'error'}
                  />
                </TableCell>
                <TableCell>
                  {t.operator_limit === null || t.operator_limit === undefined ? '∞' : t.operator_limit}
                </TableCell>
                <TableCell>{t.operators_count ?? 0}</TableCell>
                <TableCell>{t.chats_count ?? 0} / {t.open_chats ?? 0}</TableCell>
                <TableCell>{t.invites_used ?? 0} из {t.invites_issued ?? 0}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    <Button size="small" variant="contained" onClick={() => handleOpenIssue(t)}>
                      Выдать инвайты
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => handleOpenLimit(t)}>
                      Лимит мест
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color={t.status === 'active' ? 'error' : 'success'}
                      onClick={() => handleToggleStatus(t)}
                    >
                      {t.status === 'active' ? 'Приостановить' : 'Активировать'}
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {!tenants.length && (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
                  Тенантов пока нет
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Issue invites */}
      <Dialog open={!!issueTenant} onClose={() => setIssueTenant(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Выдать инвайты — {issueTenant?.name}</DialogTitle>
        <DialogContent>
          {!issuedCodes ? (
            <TextField
              autoFocus
              fullWidth
              type="number"
              label="Количество кодов"
              value={issueCount}
              onChange={(e) => setIssueCount(Math.max(1, Number(e.target.value) || 1))}
              slotProps={{ htmlInput: { min: 1, max: 100 } }}
              sx={{ mt: 1 }}
            />
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              {issuedCodes.map((code) => (
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
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIssueTenant(null)}>Закрыть</Button>
          {!issuedCodes && <Button variant="contained" onClick={handleIssue}>Создать</Button>}
        </DialogActions>
      </Dialog>

      {/* Seat limit */}
      <Dialog open={!!limitTenant} onClose={() => setLimitTenant(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Лимит мест — {limitTenant?.name}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Лимит мест"
            value={limitValue}
            onChange={(e) => setLimitValue(e.target.value)}
            placeholder="например, 10"
            helperText="Пусто = без лимита. Считаются операторы + неиспользованные инвайты."
            type="number"
            slotProps={{ htmlInput: { min: 0 } }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLimitTenant(null)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveLimit} disabled={busy}>Сохранить</Button>
        </DialogActions>
      </Dialog>
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
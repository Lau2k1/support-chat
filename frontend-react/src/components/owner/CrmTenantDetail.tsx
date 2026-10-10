import { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Button, Tabs, Tab, Chip, Dialog, DialogTitle, DialogContent, DialogActions, TextField } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import OperatorsPage from '@/components/admin/OperatorsPage';
import InvitesPage from '@/components/admin/InvitesPage';
import TagsPage from '@/components/admin/TagsPage';
import SettingsPage from '@/components/admin/SettingsPage';
import AuditPage from '@/components/admin/AuditPage';
import AdminStatsPage from '@/components/admin/AdminStatsPage';
import TelegramBotPage from '@/components/admin/TelegramBotPage';
import type { Tenant } from '@/types';

const TABS = [
  { key: 'operators', label: 'Операторы' },
  { key: 'invites', label: 'Инвайты' },
  { key: 'tags', label: 'Теги' },
  { key: 'settings', label: 'Настройки' },
  { key: 'audit', label: 'Аудит' },
  { key: 'stats', label: 'Статистика' },
  { key: 'telegram', label: 'Telegram-бот' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

interface Props {
  tenantId: number;
  onBack: () => void;
}

export default function CrmTenantDetail({ tenantId, onBack }: Props) {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [tab, setTab] = useState<TabKey>('operators');
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await superadminApi.getTenants();
      setTenant(res.data.find((t) => t.id === tenantId) ?? null);
    } catch {
      setTenant(null);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!tenant || deleteConfirm.trim() !== tenant.slug) return;
    setBusy(true);
    try {
      await superadminApi.deleteTenant(tenant.id);
      showToast('Тенант удалён');
      setDeleteOpen(false);
      onBack();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка удаления', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box>
      <Button startIcon={<ArrowBackIcon />} onClick={onBack} size="small" sx={{ mb: 1.5 }}>
        К списку клиентов
      </Button>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {loading ? 'Загрузка…' : tenant?.name ?? `Тенант #${tenantId}`}
        </Typography>
        {tenant && (
          <Chip
            size="small"
            label={tenant.status === 'active' ? 'Активен' : 'Приостановлен'}
            color={tenant.status === 'active' ? 'success' : 'error'}
          />
        )}
        {tenant && (
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteOutlineIcon />}
            sx={{ ml: 'auto' }}
            onClick={() => { setDeleteConfirm(''); setDeleteOpen(true); }}
          >
            Удалить тенант
          </Button>
        )}
      </Box>
      {tenant && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          <span style={{ fontFamily: 'monospace' }}>{tenant.slug}</span> (#{tenant.id})
        </Typography>
      )}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as TabKey)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', mb: 2 }}
      >
        {TABS.map((t) => (
          <Tab key={t.key} value={t.key} label={t.label} />
        ))}
      </Tabs>

      {tab === 'operators' && <OperatorsPage tenantId={tenantId} />}
      {tab === 'invites' && <InvitesPage tenantId={tenantId} />}
      {tab === 'tags' && <TagsPage tenantId={tenantId} />}
      {tab === 'settings' && <SettingsPage tenantId={tenantId} />}
      {tab === 'audit' && <AuditPage tenantId={tenantId} />}
      {tab === 'stats' && <AdminStatsPage tenantId={tenantId} />}
      {tab === 'telegram' && <TelegramBotPage tenantId={tenantId} />}

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle color="error.main">Удалить тенант — {tenant?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>
            Действие <b>необратимо</b>. Будут удалены все операторы, чаты, сообщения, теги, инвайты и Telegram-бот
            этого тенанта.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="Введите slug для подтверждения"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            placeholder={tenant?.slug}
            helperText={`Введите «${tenant?.slug ?? ''}»`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || deleteConfirm.trim() !== tenant?.slug}
            onClick={handleDelete}
          >
            Удалить навсегда
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

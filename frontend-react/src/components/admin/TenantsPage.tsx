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
} from '@mui/material';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import type { Tenant } from '@/types';

export default function TenantsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

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

  return (
    <Box>
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
          Создать тенант
        </Button>
      </Box>

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>ID</TableCell>
              <TableCell>Название</TableCell>
              <TableCell>slug</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Операторы</TableCell>
              <TableCell>Чаты</TableCell>
              <TableCell>Действия</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {tenants.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{t.id}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell><Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{t.slug}</Typography></TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={t.status === 'active' ? 'Активен' : 'Приостановлен'}
                    color={t.status === 'active' ? 'success' : 'error'}
                  />
                </TableCell>
                <TableCell>{t.operators_count ?? 0}</TableCell>
                <TableCell>{t.chats_count ?? 0}</TableCell>
                <TableCell>
                  <Button
                    size="small"
                    color={t.status === 'active' ? 'error' : 'success'}
                    onClick={() => handleToggleStatus(t)}
                  >
                    {t.status === 'active' ? 'Приостановить' : 'Активировать'}
                  </Button>
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
    </Box>
  );
}
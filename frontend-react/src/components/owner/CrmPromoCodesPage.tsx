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
  MenuItem,
  FormControlLabel,
  Switch,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { formatDateTime } from '@/utils/format';
import type { PromoCode, PromoInput } from '@/types';

interface Form {
  code: string;
  discountType: 'percent' | 'fixed';
  /** percent → 1..100; fixed → dollars (converted to cents on submit). */
  value: string;
  maxActivations: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
}

const EMPTY: Form = {
  code: '',
  discountType: 'percent',
  value: '10',
  maxActivations: '',
  validFrom: '',
  validUntil: '',
  isActive: true,
};

function toDateInput(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function discountLabel(p: PromoCode): string {
  return p.discount_type === 'percent' ? `${p.discount_value}%` : `$${(p.discount_value / 100).toFixed(2)}`;
}

export default function CrmPromoCodesPage() {
  const [promos, setPromos] = useState<PromoCode[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const load = useCallback(async () => {
    try {
      const res = await superadminApi.getPromoCodes();
      setPromos(res.data);
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Не удалось загрузить промокоды', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (p: PromoCode) => {
    setEditing(p);
    setForm({
      code: p.code,
      discountType: p.discount_type,
      value: p.discount_type === 'percent' ? String(p.discount_value) : (p.discount_value / 100).toString(),
      maxActivations: p.max_activations === null ? '' : String(p.max_activations),
      validFrom: toDateInput(p.valid_from),
      validUntil: toDateInput(p.valid_until),
      isActive: p.is_active,
    });
    setOpen(true);
  };

  const submit = async () => {
    const raw = Number(form.value.replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) {
      showToast('Введите корректное значение скидки', 'error');
      return;
    }
    const discountValue = form.discountType === 'percent' ? Math.round(raw) : Math.round(raw * 100);
    if (form.discountType === 'percent' && (discountValue < 1 || discountValue > 100)) {
      showToast('Процент: от 1 до 100', 'error');
      return;
    }
    const payload: PromoInput = {
      discountType: form.discountType,
      discountValue,
      maxActivations: form.maxActivations.trim() ? Number(form.maxActivations) : null,
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
      isActive: form.isActive,
    };
    if (!editing) payload.code = form.code.trim().toUpperCase() || undefined;

    setBusy(true);
    try {
      if (editing) {
        await superadminApi.updatePromoCode(editing.id, payload);
        showToast('Промокод обновлён');
      } else {
        await superadminApi.createPromoCode(payload);
        showToast('Промокод создан');
      }
      setOpen(false);
      await load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка сохранения', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = (p: PromoCode) => {
    showConfirm({
      text: `Удалить промокод ${p.code}?`,
      confirmLabel: 'Удалить',
      danger: true,
      onConfirm: async () => {
        try {
          await superadminApi.deletePromoCode(p.id);
          showToast('Промокод удалён');
          await load();
        } catch (e: any) {
          showToast(e?.response?.data?.error || 'Ошибка удаления', 'error');
        }
      },
    });
  };

  const copy = (code: string) => {
    navigator.clipboard?.writeText(code).then(
      () => showToast('Код скопирован'),
      () => showToast('Не удалось скопировать', 'error')
    );
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          Промокоды
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate}>
          Создать промокод
        </Button>
      </Box>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Код</TableCell>
              <TableCell>Скидка</TableCell>
              <TableCell>Активации</TableCell>
              <TableCell>Действует</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell>Создан</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {promos.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                  Промокодов пока нет
                </TableCell>
              </TableRow>
            )}
            {promos.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography sx={{ fontFamily: 'monospace', fontWeight: 600 }}>{p.code}</Typography>
                    <Button size="small" onClick={() => copy(p.code)} sx={{ minWidth: 0, p: 0.3 }}>
                      <ContentCopyIcon sx={{ fontSize: 15 }} />
                    </Button>
                  </Box>
                </TableCell>
                <TableCell>{discountLabel(p)}</TableCell>
                <TableCell>
                  {p.used_count}
                  {p.max_activations !== null ? ` / ${p.max_activations}` : ' / ∞'}
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {p.valid_from ? `с ${toDateInput(p.valid_from)}` : 'сразу'}
                    <br />
                    {p.valid_until ? `до ${toDateInput(p.valid_until)}` : 'бессрочно'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    label={p.is_active ? 'Активен' : 'Отключён'}
                    color={p.is_active ? 'success' : 'default'}
                  />
                </TableCell>
                <TableCell>{formatDateTime(p.created_at)}</TableCell>
                <TableCell align="right">
                  <Button size="small" onClick={() => openEdit(p)}>
                    Изменить
                  </Button>
                  <Button size="small" color="error" onClick={() => remove(p)}>
                    Удалить
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editing ? `Промокод ${editing.code}` : 'Новый промокод'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 1 }}>
            <TextField
              label="Код (необязательно)"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
              disabled={!!editing}
              placeholder="Например, START50"
              sx={{ '& input': { textTransform: 'uppercase' } }}
            />
            <TextField
              select
              label="Тип скидки"
              value={form.discountType}
              onChange={(e) => setForm({ ...form, discountType: e.target.value as 'percent' | 'fixed' })}
            >
              <MenuItem value="percent">Процент, %</MenuItem>
              <MenuItem value="fixed">Фиксированная сумма, $</MenuItem>
            </TextField>
            <TextField
              label={form.discountType === 'percent' ? 'Скидка, %' : 'Скидка, $'}
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              slotProps={{ htmlInput: { inputMode: 'decimal' } }}
            />
            <TextField
              label="Лимит активаций (пусто = без лимита)"
              value={form.maxActivations}
              onChange={(e) => setForm({ ...form, maxActivations: e.target.value })}
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            <TextField
              label="Действует с"
              type="date"
              value={form.validFrom}
              onChange={(e) => setForm({ ...form, validFrom: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Действует до"
              type="date"
              value={form.validUntil}
              onChange={(e) => setForm({ ...form, validUntil: e.target.value })}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Box>
          <FormControlLabel
            sx={{ mt: 1 }}
            control={
              <Switch checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            }
            label="Активен"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            100% скидка даёт бесплатный период на 30 дней.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Отмена</Button>
          <Button variant="contained" onClick={submit} disabled={busy}>
            {editing ? 'Сохранить' : 'Создать'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

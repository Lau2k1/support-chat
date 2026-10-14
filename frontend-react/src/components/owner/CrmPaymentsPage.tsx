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
} from '@mui/material';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { formatDateTime } from '@/utils/format';
import type { CrmPayment } from '@/types';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_LABEL: Record<CrmPayment['status'], string> = {
  pending: 'Ожидает',
  paid: 'Оплачен',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

const STATUS_COLOR: Record<CrmPayment['status'], 'success' | 'warning' | 'error' | 'default'> = {
  pending: 'warning',
  paid: 'success',
  failed: 'error',
  cancelled: 'default',
};

export default function CrmPaymentsPage() {
  const [payments, setPayments] = useState<CrmPayment[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const showToast = useUIStore((s) => s.showToast);
  const showConfirm = useUIStore((s) => s.showConfirm);

  const load = useCallback(async () => {
    try {
      const res = await superadminApi.getPayments();
      setPayments(res.data);
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Не удалось загрузить платежи', 'error');
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const confirm = (p: CrmPayment) => {
    showConfirm({
      text: `Подтвердить платёж ${money(p.amount_cents)} для «${p.tenant_name}» и активировать тариф?`,
      confirmLabel: 'Подтвердить',
      onConfirm: async () => {
        setBusyId(p.id);
        try {
          await superadminApi.confirmPayment(p.id);
          showToast('Платёж подтверждён, тариф активирован');
          await load();
        } catch (e: any) {
          showToast(e?.response?.data?.error || 'Ошибка подтверждения', 'error');
        } finally {
          setBusyId(null);
        }
      },
    });
  };

  const cancel = async (p: CrmPayment) => {
    setBusyId(p.id);
    try {
      await superadminApi.cancelPayment(p.id);
      showToast('Платёж отменён');
      await load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка отмены', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
        Платежи
      </Typography>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Дата</TableCell>
              <TableCell>Клиент</TableCell>
              <TableCell>Тариф</TableCell>
              <TableCell align="right">Сумма</TableCell>
              <TableCell>Промокод</TableCell>
              <TableCell>Способ</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                  Платежей пока нет
                </TableCell>
              </TableRow>
            )}
            {payments.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>{formatDateTime(p.created_at)}</TableCell>
                <TableCell>
                  {p.tenant_name}
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {p.tenant_slug}
                  </Typography>
                </TableCell>
                <TableCell>{p.plan_name ?? '—'}</TableCell>
                <TableCell align="right">
                  {money(p.amount_cents)}
                  {p.amount_cents !== p.base_cents && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block', textDecoration: 'line-through' }}
                    >
                      {money(p.base_cents)}
                    </Typography>
                  )}
                </TableCell>
                <TableCell>{p.promo_code ?? '—'}</TableCell>
                <TableCell>{p.method}</TableCell>
                <TableCell>
                  <Chip size="small" label={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} />
                </TableCell>
                <TableCell align="right">
                  {p.status === 'pending' && (
                    <>
                      <Button size="small" disabled={busyId === p.id} onClick={() => confirm(p)}>
                        Подтвердить
                      </Button>
                      <Button size="small" color="error" disabled={busyId === p.id} onClick={() => cancel(p)}>
                        Отменить
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

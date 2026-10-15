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
  MenuItem,
  Alert,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { useNavigate } from 'react-router-dom';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { superadminApi } from '@/services/endpoints';
import { useUIStore } from '@/stores/uiStore';
import { LIMITS, isSlug, validateRequired } from '@/utils/validation';
import { subscriptionState, toDateInput, endOfLocalDay } from '@/utils/format';
import type { Plan, Tenant } from '@/types';

/** Строка под названием тарифа в таблице клиентов: срок и состояние оплаты. */
function subscriptionHint(tenant: Tenant): string {
  return subscriptionState(tenant.paid_until, tenant.billing_status === 'active').text;
}

export default function CrmTenantsPage() {
  const navigate = useNavigate();
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

  // Subscription (plan) dialog
  const [subTenant, setSubTenant] = useState<Tenant | null>(null);
  const [subPlan, setSubPlan] = useState('');
  const [subStatus, setSubStatus] = useState<'active' | 'unpaid'>('active');
  const [subUntil, setSubUntil] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);

  // Delete tenant dialog
  const [deleteTenant, setDeleteTenant] = useState<Tenant | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await superadminApi.getTenants();
      setTenants(res.data);
    } catch {
      showToast('Ошибка загрузки тенантов', 'error');
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Каталог тарифов нужен диалогу выдачи — он не меняется, берём один раз.
  useEffect(() => {
    superadminApi
      .getPlans()
      .then((res) => setPlans(res.data))
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    const nameErr = validateRequired(name, 'Название', LIMITS.tenantName);
    if (nameErr) { showToast(nameErr, 'error'); return; }
    if (!isSlug(slug)) {
      showToast('Slug: 2–64 символа, латиница в нижнем регистре, цифры и дефис', 'error');
      return;
    }
    setBusy(true);
    try {
      await superadminApi.createTenant({ name: name.trim(), slug: slug.trim().toLowerCase() });
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

  /** Открыть диалог подписки: поля заполняются текущими значениями клиента. */
  const handleOpenSubscription = (t: Tenant) => {
    setSubPlan(t.plan_code ?? '');
    setSubStatus(t.billing_status ?? 'unpaid');
    setSubUntil(toDateInput(t.paid_until));
    setSubTenant(t);
  };

  /** Быстрый срок: сегодня + N дней (в локальной зоне, как и поле даты). */
  const presetUntil = (days: number) => {
    setSubUntil(toDateInput(new Date(Date.now() + days * 86400000)));
  };

  const handleSaveSubscription = async () => {
    if (!subTenant) return;
    setBusy(true);
    try {
      // Тариф отправляем, только если он действительно менялся: иначе сервер
      // заново применил бы лимит мест из тарифа и затёр ручную настройку.
      const planChanged = (subTenant.plan_code ?? '') !== subPlan;
      const res = await superadminApi.updateTenantSubscription(subTenant.id, {
        billingStatus: subStatus,
        paidUntil: subUntil ? endOfLocalDay(subUntil) : null,
        ...(planChanged ? { planCode: subPlan === '' ? null : subPlan } : {}),
      });
      // Понижение тарифа срезает лишние неиспользованные инвайты — владелец
      // должен это видеть, иначе пропавшие коды выглядят как баг.
      const dropped = res.data.dropped_invites ?? 0;
      showToast(
        dropped > 0 ? `Подписка обновлена · сгорело инвайтов: ${dropped}` : 'Подписка обновлена',
        dropped > 0 ? 'warning' : 'success'
      );
      setSubTenant(null);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Не удалось сохранить подписку', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleOpenDelete = (t: Tenant) => {
    setDeleteConfirm('');
    setDeleteTenant(t);
  };

  const handleDelete = async () => {
    if (!deleteTenant || deleteConfirm.trim() !== deleteTenant.slug) return;
    setBusy(true);
    try {
      await superadminApi.deleteTenant(deleteTenant.id);
      showToast('Тенант удалён');
      setDeleteTenant(null);
      load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Ошибка удаления', 'error');
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

  const selectedPlan = plans.find((p) => p.code === subPlan) ?? null;

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
          slotProps={{ htmlInput: { maxLength: LIMITS.tenantName } }}
          sx={{ width: 260 }}
        />
        <TextField
          size="small"
          label="slug (для виджета: data-tenant)"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          helperText="латиница, цифры, дефис"
          slotProps={{ htmlInput: { maxLength: 64 } }}
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
              <HeadCell>Тариф</HeadCell>
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
                  <Typography sx={{ fontWeight: 600 }}>{t.plan_name ?? '— без тарифа —'}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {subscriptionHint(t)}
                  </Typography>
                </TableCell>
                <TableCell>
                  {t.operator_limit === null || t.operator_limit === undefined ? '∞' : t.operator_limit}
                </TableCell>
                <TableCell>{t.operators_count ?? 0}</TableCell>
                <TableCell>{t.chats_count ?? 0} / {t.open_chats ?? 0}</TableCell>
                <TableCell>{t.invites_used ?? 0} из {t.invites_issued ?? 0}</TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="secondary"
                      onClick={() => navigate(`/crm?view=tenant&id=${t.id}`)}
                    >
                      Управление
                    </Button>
                    <Button size="small" variant="contained" color="success" onClick={() => handleOpenSubscription(t)}>
                      Тариф
                    </Button>
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
                    <Button size="small" variant="outlined" color="error" onClick={() => handleOpenDelete(t)}>
                      Удалить
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))}
            {!tenants.length && (
              <TableRow>
                <TableCell colSpan={8} sx={{ textAlign: 'center', color: 'text.secondary', py: 3 }}>
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
                      bgcolor: 'infoBg',
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

      {/* Subscription: выдать или сменить тариф вручную */}
      <Dialog open={!!subTenant} onClose={() => setSubTenant(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Тариф — {subTenant?.name}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Ручная выдача тарифа: клиент оплатил напрямую или вы даёте доступ на свой срок. Платёж в CRM при этом
            не создаётся.
          </Typography>

          <TextField
            select
            fullWidth
            label="Тариф"
            value={subPlan}
            onChange={(e) => {
              const next = e.target.value;
              setSubPlan(next);
              // Выдача тарифа и есть включение подписки, поэтому статус
              // переключаем сразу — поле остаётся редактируемым.
              if (next && subStatus === 'unpaid') setSubStatus('active');
            }}
            sx={{ mb: 2 }}
          >
            <MenuItem value="">— без тарифа —</MenuItem>
            {plans.map((p) => (
              <MenuItem key={p.code} value={p.code}>
                {p.name}
                {p.operator_limit !== null ? ` · до ${p.operator_limit} операторов` : ' · без лимита'}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            fullWidth
            label="Оплата"
            value={subStatus}
            onChange={(e) => setSubStatus(e.target.value as 'active' | 'unpaid')}
            sx={{ mb: 2 }}
          >
            <MenuItem value="active">Активна</MenuItem>
            <MenuItem value="unpaid">Не оплачена</MenuItem>
          </TextField>

          <TextField
            fullWidth
            type="date"
            label="Действует до"
            value={subUntil}
            onChange={(e) => setSubUntil(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="Пусто = бессрочно. Дата включительно, до конца дня."
          />

          <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
            <Button size="small" variant="outlined" onClick={() => presetUntil(30)}>+30 дней</Button>
            <Button size="small" variant="outlined" onClick={() => presetUntil(90)}>+90 дней</Button>
            <Button size="small" variant="outlined" onClick={() => presetUntil(365)}>+1 год</Button>
            <Button size="small" variant="outlined" onClick={() => setSubUntil('')}>Бессрочно</Button>
          </Box>

          {selectedPlan && subPlan !== (subTenant?.plan_code ?? '') && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Лимит мест клиента станет{' '}
              <b>{selectedPlan.operator_limit === null ? 'без лимита' : selectedPlan.operator_limit}</b> — как в тарифе
              «{selectedPlan.name}».
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSubTenant(null)}>Отмена</Button>
          <Button variant="contained" onClick={handleSaveSubscription} disabled={busy}>
            Сохранить
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete tenant */}
      <Dialog open={!!deleteTenant} onClose={() => setDeleteTenant(null)} maxWidth="sm" fullWidth>
        <DialogTitle color="error.main">Удалить тенант — {deleteTenant?.name}</DialogTitle>
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
            placeholder={deleteTenant?.slug}
            helperText={`Введите «${deleteTenant?.slug ?? ''}»`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTenant(null)}>Отмена</Button>
          <Button
            color="error"
            variant="contained"
            disabled={busy || deleteConfirm.trim() !== deleteTenant?.slug}
            onClick={handleDelete}
          >
            Удалить навсегда
          </Button>
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
        bgcolor: 'action.hover',
      }}
    >
      {children}
    </TableCell>
  );
}
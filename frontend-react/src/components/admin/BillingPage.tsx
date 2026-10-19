import { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  Button,
  TextField,
  Chip,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Divider,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import TelegramIcon from '@mui/icons-material/Telegram';
import { billingApi } from '@/services/endpoints';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { MANAGER_TELEGRAM_URL } from '@/utils/contacts';
import { formatDateTime, daysWord, subscriptionState } from '@/utils/format';
import type { BillingOverview, Payment, Plan, PromoQuote } from '@/types';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const STATUS_LABEL: Record<Payment['status'], string> = {
  pending: 'Ожидает',
  paid: 'Оплачен',
  failed: 'Ошибка',
  cancelled: 'Отменён',
};

const STATUS_COLOR: Record<Payment['status'], 'success' | 'warning' | 'error' | 'default'> = {
  pending: 'warning',
  paid: 'success',
  failed: 'error',
  cancelled: 'default',
};

export default function BillingPage() {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<PromoQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Payment | null>(null);
  const refresh = useAuthStore((s) => s.refresh);
  const showToast = useUIStore((s) => s.showToast);

  const load = useCallback(async () => {
    try {
      const res = await billingApi.get();
      setData(res.data);
      setSelected((prev) => prev ?? res.data.billing?.planCode ?? res.data.plans[0]?.code ?? null);
      const stillPending = res.data.payments.find((p) => p.status === 'pending');
      setPending(stillPending ?? null);
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Не удалось загрузить данные оплаты', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

  // While an invoice is pending, poll the provider so the UI flips to "paid"
  // without the user having to reload.
  useEffect(() => {
    if (!pending || pending.status !== 'pending' || !pending.provider_invoice_id) return;
    const t = setInterval(async () => {
      try {
        const res = await billingApi.syncPayment(pending.id);
        if (res.data.status !== 'pending') {
          showToast('Оплата получена — тариф активирован');
          setPending(null);
          await refresh();
          await load();
        }
      } catch {
        /* keep polling */
      }
    }, 6000);
    return () => clearInterval(t);
  }, [pending, showToast, refresh, load]);

  const selectPlan = (code: string) => {
    setSelected(code);
    // Re-check a promo against the newly selected plan.
    if (promo?.valid && promoInput.trim()) {
      billingApi
        .validatePromo(promoInput.trim(), code)
        .then((r) => setPromo(r.data))
        .catch(() => setPromo(null));
    }
  };

  const applyPromo = async () => {
    if (!selected) return;
    const code = promoInput.trim();
    if (!code) {
      setPromo(null);
      return;
    }
    try {
      const res = await billingApi.validatePromo(code, selected);
      // Промокод может быть выдан на конкретный тариф: тогда он действует
      // только на него — переключаем выбор и проверяем ещё раз.
      const bound = res.data.boundPlan;
      if (!res.data.valid && bound && bound.code !== selected) {
        setSelected(bound.code);
        const retry = await billingApi.validatePromo(code, bound.code);
        setPromo(retry.data);
        if (retry.data.valid) {
          showToast(`Промокод применён — выбран тариф «${bound.name}»`);
          return;
        }
        showToast(retry.data.error || 'Не удалось применить промокод', 'error');
        return;
      }
      setPromo(res.data);
      if (res.data.valid) showToast('Промокод применён');
    } catch (e: any) {
      setPromo(null);
      showToast(e?.response?.data?.error || 'Не удалось проверить промокод', 'error');
    }
  };

  const clearPromo = () => {
    setPromo(null);
    setPromoInput('');
  };

  const pay = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await billingApi.checkout(selected, promo?.valid ? promoInput.trim() : undefined);
      if (res.data.free) {
        showToast('Промокод активирован — тариф подключён');
        setPromo(null);
        setPromoInput('');
        await refresh();
        await load();
      } else if (res.data.payUrl) {
        window.open(res.data.payUrl, '_blank', 'noopener');
        setPending(res.data.payment);
        showToast('Счёт создан — оплатите его в открывшемся окне', 'info');
      } else {
        setPending(res.data.payment);
        showToast(res.data.message || 'Заявка создана — мы свяжемся с вами', 'info');
      }
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Не удалось создать счёт', 'error');
    } finally {
      setBusy(false);
    }
  };

  const syncNow = async (id: number) => {
    try {
      const res = await billingApi.syncPayment(id);
      if (res.data.status === 'paid') {
        showToast('Оплата подтверждена');
        setPending(null);
        await refresh();
        await load();
      } else {
        showToast('Оплата ещё не поступила', 'warning');
      }
    } catch {
      showToast('Не удалось проверить оплату', 'error');
    }
  };

  const cancelPayment = async (id: number) => {
    try {
      await billingApi.cancelPayment(id);
      showToast('Платёж отменён');
      setPending(null);
      await load();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'Не удалось отменить платёж', 'error');
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 5 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!data) return <Typography color="text.secondary">Нет данных</Typography>;

  const billing = data.billing;
  const active = !!billing?.active;
  // Сколько осталось от подписки и как это подсветить.
  const sub = subscriptionState(billing?.paidUntil, active);
  const daysTone =
    sub.level === 'ok'
      ? 'success.main'
      : sub.level === 'soon'
        ? 'warning.main'
        : sub.level === 'expired'
          ? 'error.main'
          : 'text.secondary';
  const selectedPlan = data.plans.find((p) => p.code === selected) ?? null;
  const promoApplied = promo?.valid && promo.amountCents !== undefined;
  const priceCents = promoApplied ? promo!.amountCents! : selectedPlan?.price_cents ?? null;

  return (
    <Box sx={{ maxWidth: 1040 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 0.5 }}>
        Тариф и оплата
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Функции сервиса доступны сразу после оплаты или активации промокода.
      </Typography>

      {/* Current subscription: which plan is active and how long is left */}
      <Card sx={{ p: 2.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <Box
            sx={{
              minWidth: 132,
              px: 2,
              py: 1.5,
              borderRadius: 2,
              textAlign: 'center',
              bgcolor: 'action.hover',
            }}
          >
            {sub.days !== null && sub.days > 0 ? (
              <>
                <Typography sx={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, color: daysTone }}>
                  {sub.days}
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: daysTone }}>
                  {daysWord(sub.days)} осталось
                </Typography>
              </>
            ) : (
              <>
                <Box sx={{ color: daysTone }}>
                  <EventAvailableIcon />
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5, color: daysTone }}>
                  {sub.text.charAt(0).toUpperCase() + sub.text.slice(1)}
                </Typography>
              </>
            )}
          </Box>

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1, minWidth: 240 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                icon={active ? <CheckCircleIcon /> : undefined}
                label={active ? 'Подписка активна' : 'Подписка не оплачена'}
                color={active ? 'success' : 'warning'}
              />
              <Typography sx={{ fontWeight: 700, fontSize: 17 }}>
                {billing?.planName ? `Тариф «${billing.planName}»` : 'Тариф не назначен'}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              {billing?.operatorLimit
                ? `До ${billing.operatorLimit} операторов по тарифу`
                : 'Без ограничения по числу операторов'}
              {billing?.paidUntil ? ` · оплачено до ${formatDateTime(billing.paidUntil)}` : ''}
            </Typography>
            {!data.providerConfigured && !active && (
              <Typography variant="body2" color="text.secondary">
                Онлайн-оплата временно недоступна — заявка будет подтверждена вручную.
              </Typography>
            )}
          </Box>
        </Box>
      </Card>

      {/* Plans */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 3,
        }}
      >
        {data.plans.map((plan) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            selected={selected === plan.code}
            current={billing?.planCode === plan.code && active}
            onSelect={() => selectPlan(plan.code)}
          />
        ))}
      </Box>

      {/* Promo + pay */}
      {selectedPlan && selectedPlan.price_cents !== null && (
        <Card sx={{ p: 2.5, mb: 3 }}>
          <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, alignItems: { sm: 'center' } }}>
            <TextField
              size="small"
              label="Промокод"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              sx={{ maxWidth: 240, '& input': { textTransform: 'uppercase', letterSpacing: 0.5 } }}
              error={!!promo && !promo.valid}
              helperText={promo && !promo.valid ? promo.error : undefined}
            />
            <Button variant="outlined" onClick={applyPromo} startIcon={<LocalOfferIcon />}>
              Применить
            </Button>
            {(promo || promoInput) && (
              <Button size="small" onClick={clearPromo}>
                Сбросить
              </Button>
            )}
            <Box sx={{ flex: 1 }} />
            <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
              {promoApplied && (
                <Typography variant="body2" color="text.secondary" sx={{ textDecoration: 'line-through' }}>
                  {money(promo!.baseCents ?? selectedPlan.price_cents!)}
                </Typography>
              )}
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {money(priceCents ?? 0)}
                <Typography component="span" variant="caption" color="text.secondary">
                  {' '}
                  / 30 дней
                </Typography>
              </Typography>
              <Button
                variant="contained"
                size="large"
                disabled={busy}
                onClick={pay}
                sx={{ mt: 1, fontWeight: 700 }}
              >
                {promoApplied && priceCents === 0 ? 'Активировать бесплатно' : 'Оплатить'}
              </Button>
            </Box>
          </Box>
          {pending && pending.status === 'pending' && (
            <Alert
              severity="info"
              sx={{ mt: 2 }}
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  {pending.pay_url && (
                    <Button
                      color="inherit"
                      size="small"
                      startIcon={<OpenInNewIcon />}
                      onClick={() => window.open(pending.pay_url!, '_blank', 'noopener')}
                    >
                      Открыть счёт
                    </Button>
                  )}
                  <Button color="inherit" size="small" onClick={() => syncNow(pending.id)}>
                    Проверить оплату
                  </Button>
                  <Button color="inherit" size="small" onClick={() => cancelPayment(pending.id)}>
                    Отменить
                  </Button>
                </Box>
              }
            >
              Ожидаем оплату {money(pending.amount_cents)}. Страница обновляется автоматически.
            </Alert>
          )}
        </Card>
      )}

      {/* History */}
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
        История платежей
      </Typography>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Дата</TableCell>
              <TableCell>Тариф</TableCell>
              <TableCell align="right">Сумма</TableCell>
              <TableCell>Промокод</TableCell>
              <TableCell>Способ</TableCell>
              <TableCell>Статус</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {data.payments.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ color: 'text.secondary', py: 3 }}>
                  Платежей пока нет
                </TableCell>
              </TableRow>
            )}
            {data.payments.map((p) => (
              <TableRow key={p.id} hover>
                <TableCell>{formatDateTime(p.created_at)}</TableCell>
                <TableCell>{data.plans.find((pl) => pl.id === p.plan_id)?.name ?? '—'}</TableCell>
                <TableCell align="right">{money(p.amount_cents)}</TableCell>
                <TableCell>
                  {p.discount_type === 'percent'
                    ? `−${p.discount_value}%`
                    : p.discount_type === 'fixed'
                      ? `−${money(p.discount_value ?? 0)}`
                      : '—'}
                </TableCell>
                <TableCell>{p.method}</TableCell>
                <TableCell>
                  <Chip size="small" label={STATUS_LABEL[p.status]} color={STATUS_COLOR[p.status]} />
                </TableCell>
                <TableCell align="right">
                  {p.status === 'pending' && (
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      {p.pay_url && (
                        <Button size="small" href={p.pay_url} target="_blank" rel="noopener">
                          Оплатить
                        </Button>
                      )}
                      <Button size="small" onClick={() => syncNow(p.id)}>
                        Проверить
                      </Button>
                    </Box>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Divider sx={{ my: 3 }} />
      <Typography variant="caption" color="text.secondary">
        Оплата обрабатывается через CryptoBot (Crypto Pay). Если онлайн-оплата недоступна, оставьте заявку — владелец
        платформы подтвердит платёж вручную.
      </Typography>
    </Box>
  );
}

function PlanCard({
  plan,
  selected,
  current,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const isCustom = plan.price_cents === null;
  // «Custom» не покупается онлайн: цена обсуждается в Telegram, туда и ведём.
  const openTelegram = () => window.open(MANAGER_TELEGRAM_URL, '_blank', 'noopener');
  return (
    <Card
      onClick={isCustom ? openTelegram : onSelect}
      sx={{
        p: 2.5,
        cursor: 'pointer',
        border: '2px solid',
        borderColor: selected && !isCustom ? 'primary.main' : 'divider',
        transition: 'border-color .15s',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {plan.name}
        </Typography>
        {current && <Chip size="small" label="Текущий" color="success" />}
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 0.5 }}>
        {isCustom ? 'По запросу' : money(plan.price_cents!)}
        {!isCustom && (
          <Typography component="span" variant="caption" color="text.secondary">
            {' '}
            / мес
          </Typography>
        )}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        {plan.operator_limit
          ? `До ${plan.operator_limit} операторов`
          : isCustom
            ? 'Операторы без лимита'
            : 'Лимит уточняется'}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1.5, fontWeight: 500 }}>
        {plan.description}
      </Typography>
      <Box component="ul" sx={{ m: 0, pl: 2.2, flex: 1, color: 'text.secondary', fontSize: 13, lineHeight: 1.9 }}>
        {(plan.features || []).map((f) => (
          <li key={f}>{f}</li>
        ))}
      </Box>
      {isCustom ? (
        <Button
          fullWidth
          variant="outlined"
          startIcon={<TelegramIcon />}
          component="a"
          href={MANAGER_TELEGRAM_URL}
          target="_blank"
          rel="noopener"
          onClick={(e) => e.stopPropagation()}
          sx={{ mt: 1.5 }}
        >
          Написать в Telegram
        </Button>
      ) : (
        <Button
          variant={selected ? 'contained' : 'outlined'}
          fullWidth
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          sx={{ mt: 1.5 }}
        >
          {selected ? 'Выбрано' : 'Выбрать'}
        </Button>
      )}
    </Card>
  );
}

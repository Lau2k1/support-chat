import { Alert, Button, Box } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import { useAuthStore } from '@/stores/authStore';

/**
 * Persistent notice shown while the tenant's subscription is not active: the
 * whole panel stays visible (read-only) but every action is blocked server-side.
 */
export default function PaywallBanner({ onGoToBilling }: { onGoToBilling?: () => void }) {
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const billing = useAuthStore((s) => s.user?.billing);
  const expired = billing?.status === 'active' && !!billing.paidUntil;

  const text = expired
    ? 'Срок действия тарифа истёк — функции недоступны до продления оплаты.'
    : 'Тариф не оплачен — все разделы видны, но пользоваться сервисом можно только после оплаты.';

  return (
    <Alert
      icon={<LockIcon fontSize="inherit" />}
      severity="warning"
      sx={{ borderRadius: 0, alignItems: 'center' }}
      action={
        isAdmin && onGoToBilling ? (
          <Button color="inherit" size="small" onClick={onGoToBilling} sx={{ fontWeight: 700 }}>
            Перейти к оплате
          </Button>
        ) : undefined
      }
    >
      <Box component="span" sx={{ fontWeight: 600 }}>
        {text}
      </Box>
      {!isAdmin && ' Попросите администратора аккаунта оплатить тариф.'}
    </Alert>
  );
}

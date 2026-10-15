import { Box, Button, Paper, Typography } from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { useAuthStore } from '@/stores/authStore';

interface Props {
  /** Name of the gated capability, e.g. «Тикет-система». */
  title: string;
  /** What the feature gives the team. */
  description: string;
  /** Plan that unlocks the feature (shown as a pill). */
  requiredPlan: string;
  /** Admins get a button that jumps to the billing section; operators do not. */
  onUpgrade?: () => void;
}

/**
 * Placeholder shown instead of a section the tenant's plan does not include.
 *
 * The section stays reachable on purpose: seeing the feature with an upgrade
 * prompt converts better than hiding it, and reads are allowed server-side so a
 * tenant that downgraded can still reach its existing data through the API.
 */
export default function FeatureLocked({ title, description, requiredPlan, onUpgrade }: Props) {
  const isAdmin = useAuthStore((s) => s.isAdmin);

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: '70%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 3,
      }}
    >
      <Paper
        variant="outlined"
        sx={{
          maxWidth: 460,
          p: 4,
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'action.hover',
            color: 'text.secondary',
          }}
        >
          <LockOutlinedIcon />
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>

        <Typography variant="body2" color="text.secondary">
          Доступно на тарифе{' '}
          <Box component="span" sx={{ fontWeight: 700, color: 'primary.main' }}>
            {requiredPlan}
          </Box>{' '}
          и выше.
        </Typography>

        {isAdmin && onUpgrade ? (
          <Button variant="contained" onClick={onUpgrade} sx={{ mt: 1 }}>
            Перейти к тарифам
          </Button>
        ) : isAdmin ? (
          // Admin, but standing in a panel that has no billing section — point
          // them at the place where the plan actually changes.
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Сменить тариф можно в админ-панели, раздел «Оплата».
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
            Попросите администратора аккаунта сменить тариф.
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

import { Snackbar, Alert } from '@mui/material';
import { useUIStore } from '@/stores/uiStore';

export default function Toast() {
  const { toast, hideToast } = useUIStore();

  return (
    <Snackbar
      open={!!toast}
      autoHideDuration={3000}
      onClose={hideToast}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
    >
      {toast ? (
        <Alert severity={toast.severity} onClose={hideToast} variant="filled">
          {toast.message}
        </Alert>
      ) : undefined}
    </Snackbar>
  );
}

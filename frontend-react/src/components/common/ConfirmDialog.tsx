import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from '@mui/material';
import { useUIStore } from '@/stores/uiStore';

export default function ConfirmDialog() {
  const { confirmDialog, hideConfirm } = useUIStore();

  if (!confirmDialog) return null;

  return (
    <Dialog open maxWidth="xs" onClose={hideConfirm}>
      <DialogTitle>Подтверждение</DialogTitle>
      <DialogContent>
        <Typography>{confirmDialog.text}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={hideConfirm} color="inherit">
          Отмена
        </Button>
        <Button
          onClick={() => {
            confirmDialog.onConfirm();
            hideConfirm();
          }}
          color={confirmDialog.danger ? 'error' : 'primary'}
          variant="contained"
        >
          {confirmDialog.confirmLabel || 'Подтвердить'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

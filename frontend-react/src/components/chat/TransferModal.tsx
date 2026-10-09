import {
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  Box,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useChatStore } from '@/stores/chatStore';
import { wsManager } from '@/services/ws';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  chatId: number | null;
}

export default function TransferModal({ open, onClose, chatId }: TransferModalProps) {
  const { onlineOperators } = useChatStore();

  const handleTransfer = (operatorId: number) => {
    if (!chatId) return;
    wsManager.send({ type: 'transfer_chat', chatId, targetOperatorId: operatorId });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Передать чат
        <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
      </DialogTitle>
      <DialogContent>
        <List dense>
          {onlineOperators.length === 0 && (
            <ListItemText primary="Нет операторов онлайн" sx={{ color: 'text.secondary', textAlign: 'center' }} />
          )}
          {onlineOperators.map((op) => (
            <ListItemButton key={op.id} onClick={() => handleTransfer(op.id)} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, mb: 0.5 }}>
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#4ade80' }} />
              </ListItemIcon>
              <ListItemText primary={op.name} />
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}

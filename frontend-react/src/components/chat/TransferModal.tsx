import {
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  IconButton,
  Box,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { wsManager } from '@/services/ws';

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  chatId: number | null;
}

const statusColor: Record<string, string> = { online: '#4ade80', busy: '#f59e0b', offline: '#94a3b8' };
const statusLabel: Record<string, string> = { online: 'Онлайн', busy: 'Занят', offline: 'Офлайн' };

export default function TransferModal({ open, onClose, chatId }: TransferModalProps) {
  const { onlineOperators } = useChatStore();
  const myId = useAuthStore((s) => s.user?.id ?? null);

  const sorted = [...onlineOperators].sort((a, b) => {
    const order = { online: 0, busy: 1, offline: 2 } as const;
    const ao = order[a.status || 'offline'];
    const bo = order[b.status || 'offline'];
    return ao - bo || a.name.localeCompare(b.name, 'ru');
  });

  const canTransfer = (operatorId: number, status?: string) =>
    chatId !== null && status === 'online' && operatorId !== myId;

  const handleTransfer = (operatorId: number, status?: string) => {
    if (!canTransfer(operatorId, status) || !chatId) return;
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
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Перевести можно только свободному оператору (статус «Онлайн»).
        </Typography>
        {sorted.length === 0 && (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2, fontSize: 13 }}>
            Нет доступных операторов
          </Typography>
        )}
        <List dense>
          {sorted.map((op) => {
            const status = op.status || 'offline';
            const self = op.id === myId;
            const blocked = status !== 'online' || self;
            const hint = self
              ? 'Это вы'
              : status === 'busy'
                ? 'Занят другим чатом'
                : status === 'offline'
                  ? 'Не в сети'
                  : undefined;
            return (
              <ListItemButton
                key={op.id}
                disabled={blocked}
                onClick={() => handleTransfer(op.id, status)}
                sx={{ borderRadius: 1, mb: 0.5, border: '1px solid', borderColor: 'divider' }}
              >
                <ListItemAvatar sx={{ minWidth: 40 }}>
                  <Avatar sx={{ width: 28, height: 28, bgcolor: 'action.hover', color: 'text.primary', fontSize: 12, fontWeight: 700 }}>
                    {op.name.charAt(0).toUpperCase()}
                  </Avatar>
                </ListItemAvatar>
                <ListItemText
                  primary={<Typography variant="body2" sx={{ fontWeight: 600 }}>{op.name}</Typography>}
                  secondary={
                    <Typography variant="caption" color={blocked ? 'text.disabled' : 'text.secondary'}>
                      {hint || 'Готов принять чат'}
                    </Typography>
                  }
                />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  <Box
                    component="span"
                    sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: statusColor[status], display: 'inline-block' }}
                  />
                  <Typography variant="caption" sx={{ fontWeight: 600, color: blocked ? 'text.disabled' : 'text.secondary' }}>
                    {statusLabel[status]}
                  </Typography>
                </Box>
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>
    </Dialog>
  );
}
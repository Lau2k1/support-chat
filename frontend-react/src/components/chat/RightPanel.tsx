import { Box, Typography, Divider } from '@mui/material';
import { useChatStore } from '@/stores/chatStore';

export default function RightPanel() {
  const { cannedResponses, currentChatId, chatNames } = useChatStore();
  const clientName = currentChatId ? chatNames[String(currentChatId)] : undefined;

  return (
    <Box
      sx={{
        width: 240,
        bgcolor: '#fff',
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: '#f1f5f9' }}>
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase' }} color="text.secondary">
          Информация
        </Typography>
        <Box sx={{ mt: 1 }}>
          <Typography variant="body2" color="text.secondary">Клиент: {clientName || '—'}</Typography>
          <Typography variant="body2" color="text.secondary">Устройство: —</Typography>
          <Typography variant="body2" color="text.secondary">Регион: —</Typography>
        </Box>
      </Box>
      <Divider />
      <Box sx={{ p: 1.5 }}>
        <Typography variant="caption" sx={{ fontWeight: 600, textTransform: 'uppercase' }} color="text.secondary">
          Шаблоны
        </Typography>
        <Box sx={{ mt: 1 }}>
          {cannedResponses.slice(0, 5).map((t) => (
            <Box
              key={t.id}
              sx={{
                p: 0.75,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                mb: 0.5,
                cursor: 'pointer',
                '&:hover': { bgcolor: '#f0f4ff' },
              }}
            >
              <Typography variant="body2" sx={{ fontWeight: 600, fontSize: 12 }}>{t.title}</Typography>
              <Typography variant="caption" color="text.secondary">/{t.shortcut}</Typography>
            </Box>
          ))}
          {cannedResponses.length === 0 && (
            <Typography variant="caption" color="text.secondary">Нет шаблонов</Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}

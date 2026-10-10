import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Button,
  Card,
  Grid,
  Chip,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import InfoIcon from '@mui/icons-material/Info';
import CloseIcon from '@mui/icons-material/Close';
import LabelIcon from '@mui/icons-material/Label';
import SendIcon from '@mui/icons-material/Send';
import TopBar from '@/components/layout/TopBar';
import SideNav from '@/components/layout/SideNav';
import ChatSidebar from '@/components/chat/ChatSidebar';
import MessageList from '@/components/chat/MessageList';
import ChatInput, { type ChatInputApi } from '@/components/chat/ChatInput';
import RightPanel from '@/components/chat/RightPanel';
import TemplateModal from '@/components/chat/TemplateModal';
import TransferModal from '@/components/chat/TransferModal';
import TagSelectorModal from '@/components/chat/TagSelectorModal';
import ArchiveFiltersComponent from '@/components/archive/ArchiveFilters';
import ArchiveList from '@/components/archive/ArchiveList';
import MessageListArchive from '@/components/chat/MessageList';
import { useChatStore } from '@/stores/chatStore';
import { useUIStore } from '@/stores/uiStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { wsManager } from '@/services/ws';
import { chatApi, statsApi, cannedApi, adminApi } from '@/services/endpoints';
import type { Chat, ArchiveFilters, Stats, DailyStat } from '@/types';

type ViewType = 'chats' | 'archive' | 'stats';

export default function OperatorDashboard() {
  const [currentView, setCurrentView] = useState<ViewType>('chats');
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [tagSelectorOpen, setTagSelectorOpen] = useState(false);
  const chatInputRef = useRef<ChatInputApi | null>(null);

  const { currentChatId, messages, setCurrentChat, addTab, setMessages, setAllTags, setCannedResponses, setUnread } = useChatStore();
  const showConfirm = useUIStore((s) => s.showConfirm);

  useWebSocket();

  useEffect(() => {
    const loadData = async () => {
      try {
        const [tagsRes, cannedRes] = await Promise.all([
          adminApi.getTags(),
          cannedApi.getAll(),
        ]);
        setAllTags(tagsRes.data);
        setCannedResponses(cannedRes.data);
      } catch (e) {
        console.error('Failed to load initial data:', e);
      }
    };
    loadData();
  }, [setAllTags, setCannedResponses]);

  const handleSelectChat = useCallback(async (chatId: number) => {
    setCurrentChat(chatId);
    addTab(chatId);
    setUnread(String(chatId), 0);

    try {
      const res = await chatApi.getMessages(chatId);
      setMessages(String(chatId), res.data);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }

    wsManager.send({ type: 'join_chat', chatId });
  }, [setCurrentChat, addTab, setUnread, setMessages]);

  const handleCloseChat = (chatId: number) => {
    showConfirm({
      text: 'Завершить чат?',
      confirmLabel: 'Закрыть',
      danger: true,
      onConfirm: () => {
        wsManager.send({ type: 'close_chat', chatId });
      },
    });
  };

  const currentMessages = currentChatId ? messages[String(currentChatId)] || [] : [];

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <TopBar />
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <SideNav currentView={currentView} onViewChange={setCurrentView} />

        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {currentView === 'chats' && (
            <ChatsView
              currentChatId={currentChatId}
              messages={currentMessages}
              onSelectChat={handleSelectChat}
              onCloseChat={handleCloseChat}
              showRightPanel={showRightPanel}
              onToggleRightPanel={() => setShowRightPanel(!showRightPanel)}
              onOpenTemplates={() => setTemplateOpen(true)}
              onOpenTransfer={() => setTransferOpen(true)}
              onOpenTagSelector={() => setTagSelectorOpen(true)}
              chatInputRef={chatInputRef}
            />
          )}
          {currentView === 'archive' && <ArchiveView />}
          {currentView === 'stats' && <StatsView />}
        </Box>
      </Box>

      <TemplateModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        onInsert={(content) => {
          chatInputRef.current?.insertTemplate(content);
        }}
      />
      <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} chatId={currentChatId} />
      <TagSelectorModal open={tagSelectorOpen} onClose={() => setTagSelectorOpen(false)} chatId={currentChatId} />
    </Box>
  );
}

function ChatsView({
  currentChatId,
  messages,
  onSelectChat,
  onCloseChat,
  showRightPanel,
  onToggleRightPanel,
  onOpenTemplates,
  onOpenTransfer,
  onOpenTagSelector,
  chatInputRef,
}: {
  currentChatId: number | null;
  messages: import('@/types').Message[];
  onSelectChat: (id: number) => void;
  onCloseChat: (id: number) => void;
  showRightPanel: boolean;
  onToggleRightPanel: () => void;
  onOpenTemplates: () => void;
  onOpenTransfer: () => void;
  onOpenTagSelector: () => void;
  chatInputRef: React.Ref<ChatInputApi> | undefined;
}) {
  const chatSources = useChatStore((s) => s.chatSources);
  const chatNames = useChatStore((s) => s.chatNames);
  const source = currentChatId ? chatSources[String(currentChatId)] : undefined;
  const chatName = currentChatId ? chatNames[String(currentChatId)] : undefined;
  const isTelegram = source === 'telegram';

  return (
    <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <ChatSidebar onSelectChat={onSelectChat} currentChatId={currentChatId} />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          sx={{
            height: 50,
            bgcolor: '#fff',
            px: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid',
            borderColor: 'divider',
            fontWeight: 600,
            fontSize: 14,
            flexShrink: 0,
          }}
        >
           <Typography sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
            {currentChatId ? (chatName || `${isTelegram ? 'Telegram' : 'Клиент'} #${currentChatId}`) : 'Выберите чат'}
            {currentChatId && isTelegram && (
              <Chip
                icon={<SendIcon sx={{ fontSize: 14 }} />}
                label="Telegram"
                size="small"
                sx={{ height: 20, fontSize: 11, bgcolor: '#e0f2fe', color: '#0284c7', '& .MuiChip-icon': { color: '#0284c7' } }}
              />
            )}
          </Typography>
          {currentChatId && (
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button size="small" variant="outlined" startIcon={<SwapHorizIcon />} onClick={onOpenTransfer}>
                Передать
              </Button>
              <IconButton size="small" onClick={onToggleRightPanel}>
                <InfoIcon fontSize="small" />
              </IconButton>
              <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => onCloseChat(currentChatId)}>
                Закрыть
              </Button>
            </Box>
          )}
        </Box>

        {currentChatId ? (
          <>
            <MessageList messages={messages} chatId={currentChatId} />
            <ChatInput chatId={currentChatId} onOpenTemplates={onOpenTemplates} onOpenTagSelector={onOpenTagSelector} apiRef={chatInputRef} />
          </>
        ) : (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
            <Typography>Выберите чат из списка слева</Typography>
          </Box>
        )}
      </Box>

      {showRightPanel && <RightPanel />}
    </Box>
  );
}

function ArchiveView() {
  const [filters, setFilters] = useState<ArchiveFilters>({ status: '', from: '', to: '', tagIds: [] });
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [archiveMessages, setArchiveMessages] = useState<import('@/types').Message[]>([]);
  const [archiveTagOpen, setArchiveTagOpen] = useState(false);
  const { allTags } = useChatStore();

  const loadArchive = useCallback(async () => {
    try {
      const params: any = {};
      if (filters.status) params.status = filters.status;
      if (filters.from) params.from = filters.from;
      if (filters.to) params.to = filters.to;
      if (filters.tagIds.length) params.tagId = filters.tagIds;
      const res = await chatApi.getChats(params);
      setChats(res.data);
    } catch {
      console.error('Failed to load archive');
    }
  }, [filters]);

  useEffect(() => {
    loadArchive();
  }, [loadArchive]);

  const handleSelectArchiveChat = async (chatId: number) => {
    setSelectedId(chatId);
    try {
      const res = await chatApi.getMessages(chatId);
      setArchiveMessages(res.data);
    } catch {
      setArchiveMessages([]);
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <ArchiveFiltersComponent
          filters={filters}
          onChange={setFilters}
          onReset={() => setFilters({ status: '', from: '', to: '', tagIds: [] })}
          tags={allTags}
        />
        <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <ArchiveList chats={chats} selectedId={selectedId} onSelect={handleSelectArchiveChat} />
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <Box sx={{ height: 50, bgcolor: '#fff', px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
              <Typography sx={{ fontWeight: 600 }}>
                {selectedId
                  ? `${chats.find((c) => c.id === selectedId)?.client_name || `Клиент #${selectedId}`} (архив)`
                  : 'Выберите чат из архива'}
              </Typography>
              {selectedId && (
                <Button size="small" variant="outlined" startIcon={<LabelIcon />} onClick={() => setArchiveTagOpen(true)}>
                  Теги
                </Button>
              )}
            </Box>
            {selectedId ? (
              <MessageListArchive messages={archiveMessages} />
            ) : (
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
                <Typography>Выберите чат из архива</Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>
      <TagSelectorModal open={archiveTagOpen} onClose={() => { setArchiveTagOpen(false); loadArchive(); }} chatId={selectedId} />
    </Box>
  );
}

function StatsView() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<DailyStat[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [statsRes, dailyRes] = await Promise.all([statsApi.getStats(), statsApi.getDaily()]);
        setStats(statsRes.data);
        setDaily(dailyRes.data);
      } catch {
        console.error('Failed to load stats');
      }
    };
    load();
  }, []);

  if (!stats) return <Box sx={{ p: 3, textAlign: 'center' }}>Загрузка...</Box>;

  const cards = [
    { value: stats.totalChats, label: 'Всего чатов' },
    { value: stats.openChats, label: 'Открытых' },
    { value: stats.closedChats, label: 'Закрытых' },
    { value: stats.totalMessages, label: 'Сообщений' },
    { value: `${stats.avgResponseSec}с`, label: 'Ср. время ответа' },
    { value: stats.avgRating || '—', label: 'Ср. рейтинг' },
  ];

  const maxCount = Math.max(...daily.map((d) => d.count), 1);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 3, overflowY: 'auto', flex: 1 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2.5 }}>
        Статистика
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((c) => (
          <Grid size={{ xs: 6, sm: 4, md: 2 }} key={c.label}>
            <Card sx={{ p: 2.5, textAlign: 'center' }}>
              <Typography variant="h4" sx={{ fontWeight: 700 }} color="primary">{c.value}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {c.label}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ p: 2.5, mb: 2.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>
          Чаты за последние 7 дней
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 160, pt: 2 }}>
          {daily.map((d) => (
            <Box key={d.day} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>{d.count}</Typography>
              <Box
                sx={{
                  width: '100%',
                  bgcolor: 'primary.main',
                  borderRadius: '4px 4px 0 0',
                  minHeight: 2,
                  height: `${(d.count / maxCount) * 100}%`,
                  transition: 'height 0.3s',
                }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>{d.day}</Typography>
            </Box>
          ))}
        </Box>
      </Card>
    </Box>
  );
}

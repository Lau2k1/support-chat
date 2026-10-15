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
import VisibilityIcon from '@mui/icons-material/Visibility';
import ChatBubbleOutlineOutlinedIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import MarkChatUnreadIcon from '@mui/icons-material/MarkChatUnread';
import CheckCircleOutlineOutlinedIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ForumIcon from '@mui/icons-material/Forum';
import TimerIcon from '@mui/icons-material/Timer';
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
import PaywallBanner from '@/components/common/PaywallBanner';
import FeatureLocked from '@/components/common/FeatureLocked';
import TicketsPage from '@/components/tickets/TicketsPage';
import { useChatStore } from '@/stores/chatStore';
import { useAuthStore } from '@/stores/authStore';
import { useUIStore } from '@/stores/uiStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { wsManager } from '@/services/ws';
import { chatApi, statsApi, cannedApi } from '@/services/endpoints';
import type { Chat, ArchiveFilters, Stats, DailyStat } from '@/types';
import { formatDuration } from '@/utils/format';

/** Upgrade copy for the ticket section (plan gated — sold from «Профи»). */
const TICKETS_LOCK = {
  title: 'Тикет-система',
  description:
    'Сложные обращения не теряются в переписке: шаблоны с полями, статусы «решено» / «не решено», архив и статистика по тикетам.',
  requiredPlan: 'Профи',
};

type ViewType = 'chats' | 'archive' | 'stats' | 'tickets';

export default function OperatorDashboard() {
  const [currentView, setCurrentView] = useState<ViewType>('chats');
  const [showRightPanel, setShowRightPanel] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [tagSelectorOpen, setTagSelectorOpen] = useState(false);
  const chatInputRef = useRef<ChatInputApi | null>(null);

  const { currentChatId, messages, setCurrentChat, addTab, setMessages, setAllTags, setCannedResponses, setUnread } = useChatStore();
  const showConfirm = useUIStore((s) => s.showConfirm);
  const billingActive = useAuthStore((s) => s.billingActive);
  const canUseTickets = useAuthStore((s) => s.canUseTickets);

  useWebSocket();

  useEffect(() => {
    const loadData = async () => {
      try {
        const [tagsRes, cannedRes] = await Promise.all([
          chatApi.getTags(),
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
      {!billingActive && <PaywallBanner />}
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
          {currentView === 'tickets' &&
            (canUseTickets ? <TicketsPage /> : <FeatureLocked {...TICKETS_LOCK} />)}
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
  chatInputRef: React.RefObject<ChatInputApi | null>;
}) {
  const chatSources = useChatStore((s) => s.chatSources);
  const chatNames = useChatStore((s) => s.chatNames);
  const chatPublicCodes = useChatStore((s) => s.chatPublicCodes);
  const chatTags = useChatStore((s) => s.chatTags);
  const chatAssignees = useChatStore((s) => s.chatAssignees);
  const setChatTags = useChatStore((s) => s.setChatTags);
  const myId = useAuthStore((s) => s.user?.id ?? null);
  const billingActive = useAuthStore((s) => s.billingActive);
  const source = currentChatId ? chatSources[String(currentChatId)] : undefined;
  const chatName = currentChatId ? chatNames[String(currentChatId)] : undefined;
  const isTelegram = source === 'telegram';
  const publicCode = currentChatId ? (chatPublicCodes[String(currentChatId)] || `#${currentChatId}`) : '';
  const currentTags = currentChatId ? chatTags[String(currentChatId)] || [] : [];
  const assignee = currentChatId ? chatAssignees[String(currentChatId)] : undefined;
  // A chat owned by another operator may be watched, but not answered.
  const isObserver = !!assignee && assignee.id !== myId;

  // Load the tags attached to the open chat (they are not part of init_operator).
  useEffect(() => {
    if (!currentChatId) return;
    let cancelled = false;
    chatApi
      .getChatTags(currentChatId)
      .then((res) => {
        if (!cancelled) setChatTags(String(currentChatId), res.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [currentChatId, setChatTags]);

  const handleRemoveTag = async (tagId: number) => {
    if (!currentChatId) return;
    try {
      await chatApi.removeTag(currentChatId, tagId);
      const res = await chatApi.getChatTags(currentChatId);
      setChatTags(String(currentChatId), res.data);
    } catch {
      /* ignore */
    }
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <ChatSidebar onSelectChat={onSelectChat} currentChatId={currentChatId} />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Box
          sx={{
            height: 50,
            bgcolor: 'background.paper',
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
           <Typography sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentChatId ? (chatName || (isTelegram ? 'Telegram' : 'Клиент')) : 'Выберите чат'}
            </Box>
            {currentChatId && (
              <Chip
                label={publicCode}
                size="small"
                sx={{ height: 20, fontSize: 11, fontFamily: 'monospace', bgcolor: 'action.hover' }}
              />
            )}
            {currentChatId && isTelegram && (
              <Chip
                icon={<SendIcon sx={{ fontSize: 14 }} />}
                label="Telegram"
                size="small"
                sx={{ height: 20, fontSize: 11, bgcolor: 'infoBg', color: 'info.main', '& .MuiChip-icon': { color: 'info.main' } }}
              />
            )}
          </Typography>
          {currentChatId && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
              {currentTags.map((t) => (
                <Chip
                  key={t.id}
                  label={t.name}
                  size="small"
                  onDelete={() => handleRemoveTag(t.id)}
                  title="Снять тег"
                  sx={{ height: 22, fontSize: 11, bgcolor: t.color || 'primary.main', color: '#fff' }}
                />
              ))}
              <Button size="small" variant="outlined" startIcon={<SwapHorizIcon />} onClick={onOpenTransfer}>
                Передать
              </Button>
              {!isObserver && (
                <Button size="small" variant="outlined" color="error" startIcon={<CloseIcon />} onClick={() => onCloseChat(currentChatId)}>
                  Закрыть
                </Button>
              )}
              <IconButton size="small" onClick={onToggleRightPanel}>
                <InfoIcon fontSize="small" />
              </IconButton>
            </Box>
          )}
        </Box>

        {currentChatId ? (
          <>
            {isObserver && (
              <Box
                sx={{
                  px: 2,
                  py: 0.75,
                  bgcolor: 'infoBg',
                  borderBottom: '1px solid',
                  borderColor: 'info.main',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  flexShrink: 0,
                }}
              >
                <VisibilityIcon sx={{ fontSize: 15, color: 'info.main' }} />
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'info.main' }}>
                  Режим наблюдения — чат оператора {assignee?.name}. Отправка сообщений недоступна.
                </Typography>
              </Box>
            )}
            <MessageList messages={messages} chatId={currentChatId} />
            <ChatInput chatId={currentChatId} onOpenTemplates={onOpenTemplates} onOpenTagSelector={onOpenTagSelector} readOnly={isObserver || !billingActive} apiRef={chatInputRef} />
          </>
        ) : (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
            <Typography>Выберите чат из списка слева</Typography>
          </Box>
        )}
      </Box>

      {showRightPanel && (
        <RightPanel onInsertTemplate={(content) => chatInputRef.current?.insertTemplate(content)} />
      )}
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

  const selectedChat = selectedId ? chats.find((c) => c.id === selectedId) : undefined;

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
            <Box sx={{ height: 50, bgcolor: 'background.paper', px: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid', borderColor: 'divider', fontWeight: 600, fontSize: 14, flexShrink: 0 }}>
              <Typography sx={{ fontWeight: 600 }}>
                {selectedId
                  ? `${selectedChat?.client_name || 'Клиент'} · ${selectedChat?.public_code || `#${selectedId}`} (архив)`
                  : 'Выберите чат из архива'}
              </Typography>
              {selectedId && (
                <Button size="small" variant="outlined" startIcon={<LabelIcon />} onClick={() => setArchiveTagOpen(true)}>
                  Теги
                </Button>
              )}
            </Box>
            {selectedId ? (
              <MessageList messages={archiveMessages} />
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

  const cards: { value: React.ReactNode; label: string; color: string; icon: React.ReactNode }[] = [
    { value: stats.totalChats, label: 'Всего чатов', color: '#007bff', icon: <ChatBubbleOutlineOutlinedIcon fontSize="small" /> },
    { value: stats.openChats, label: 'Открытых', color: '#f59e0b', icon: <MarkChatUnreadIcon fontSize="small" /> },
    { value: stats.closedChats, label: 'Закрытых', color: '#10b981', icon: <CheckCircleOutlineOutlinedIcon fontSize="small" /> },
    { value: stats.totalMessages, label: 'Сообщений', color: '#8b5cf6', icon: <ForumIcon fontSize="small" /> },
    { value: formatDuration(stats.avgResponseSec), label: 'Ср. ответ', color: '#06b6d4', icon: <TimerIcon fontSize="small" /> },
  ];

  const maxCount = Math.max(...daily.map((d) => d.count), 1);
  const weekTotal = daily.reduce((sum, d) => sum + d.count, 0);
  const best = daily.reduce<DailyStat | null>((top, d) => (!top || d.count > top.count ? d : top), null);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', p: 3, overflowY: 'auto', flex: 1 }}>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2.5 }}>
        Статистика
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {cards.map((c) => (
          <Grid size={{ xs: 6, sm: 4, md: 2 }} key={c.label}>
            <Card
              sx={{
                p: 2,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                borderTop: '3px solid',
                borderColor: c.color,
                transition: 'box-shadow .2s ease, transform .2s ease',
                '&:hover': { boxShadow: 4, transform: 'translateY(-2px)' },
              }}
            >
              <Box sx={{ color: c.color, display: 'flex', mb: 0.5 }}>{c.icon}</Box>
              <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2, whiteSpace: 'nowrap' }}>
                {c.value}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.25, mt: 0.25 }}>
                {c.label}
              </Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 2, gap: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Чаты за последние 7 дней
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'right' }}>
            Всего: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>{weekTotal}</Box>
            {best && best.count > 0 && ` • лучший день: ${best.day} (${best.count})`}
          </Typography>
        </Box>

        {daily.length === 0 ? (
          <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
            Нет данных за последние 7 дней
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            {daily.map((d) => {
              const pct = Math.round((d.count / maxCount) * 100);
              return (
                <Box key={d.day} sx={{ flex: 1, minWidth: 0 }}>
                  {/* Колонка фиксированной высоты: без неё `height: %` у столбика
                      считается от auto-родителя и схлопывается в minHeight. */}
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', height: 180 }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                      {d.count}
                    </Typography>
                    <Box sx={{ flex: 1, width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <Box
                        title={`${d.day}: ${d.count}`}
                        sx={{
                          width: '62%',
                          maxWidth: 46,
                          minHeight: 3,
                          height: `${pct}%`,
                          borderRadius: '6px 6px 0 0',
                          background: 'linear-gradient(180deg, #63b3ff 0%, #007bff 100%)',
                          transition: 'height .3s ease, filter .2s ease',
                          '&:hover': { filter: 'brightness(1.12)' },
                        }}
                      />
                    </Box>
                  </Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', textAlign: 'center', mt: 0.75 }}
                  >
                    {d.day}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        )}
      </Card>
    </Box>
  );
}

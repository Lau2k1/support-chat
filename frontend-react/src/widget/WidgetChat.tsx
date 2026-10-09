import { useState, useRef, useEffect, useCallback } from 'react';
import { useWidgetWs } from './useWidgetWs';

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDate.getTime() === today.getTime()) return 'Сегодня';
  if (msgDate.getTime() === yesterday.getTime()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function shouldShowDateSeparator(messages: { created_at: number }[], idx: number): boolean {
  if (idx === 0) return true;
  const prev = messages[idx - 1].created_at;
  const curr = messages[idx].created_at;
  const prevDay = new Date(prev).setHours(0, 0, 0, 0);
  const currDay = new Date(curr).setHours(0, 0, 0, 0);
  if (currDay !== prevDay) return true;
  return curr - prev > 5 * 60 * 1000;
}

interface MessageGroup {
  senderId: number;
  senderName: string;
  messages: { idx: number; id: number; content: string; message_type: string; file_url?: string | null; created_at: number }[];
}

function groupMessages(messages: { id: number; sender_id: number; sender_name?: string; content: string; message_type: string; file_url?: string | null; created_at: number }[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const last = groups[groups.length - 1];
    if (last && last.senderId === m.sender_id && m.created_at - last.messages[last.messages.length - 1].created_at < 2 * 60 * 1000) {
      last.messages.push({ idx: i, id: m.id, content: m.content, message_type: m.message_type, file_url: m.file_url, created_at: m.created_at });
    } else {
      groups.push({
        senderId: m.sender_id,
        senderName: m.sender_name || (m.sender_id === 0 ? 'Клиент' : 'Оператор'),
        messages: [{ idx: i, id: m.id, content: m.content, message_type: m.message_type, file_url: m.file_url, created_at: m.created_at }],
      });
    }
  }
  return groups;
}

const ChatIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>
);

const SendIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
);

const AttachIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/></svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
);

export default function WidgetChat() {
  const {
    chatId,
    messages,
    isTyping,
    operatorsOffline,
    chatClosed,
    connected,
    sendMessage,
    closeChat,
    uploadFile,
    sendTypingStart,
    sendTypingStop,
    openWidget,
    resetChat,
  } = useWidgetWs();

  const [isOpen, setIsOpen] = useState(() => !!localStorage.getItem('activeChatId'));
  const [closing, setClosing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [unread, setUnread] = useState(0);
  const [ratingChatId, setRatingChatId] = useState<number | null>(null);
  const [ratingValue, setRatingValue] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen && textareaRef.current) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [isOpen, chatId]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 100) + 'px';
    }
  }, [inputValue]);

  const prevMsgCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length > prevMsgCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.sender_id !== 0) {
        if (!isOpen) {
          setUnread((u) => u + 1);
        }
        playNotifySound();
      }
    }
    prevMsgCountRef.current = messages.length;
  }, [messages.length, isOpen]);

  useEffect(() => {
    if (chatClosed && chatId) {
      setRatingChatId(chatId);
      setRatingValue(0);
      setHoverRating(0);
      setRatingSubmitted(false);
    }
  }, [chatClosed, chatId]);

  useEffect(() => {
    if (isOpen) {
      setUnread(0);
    }
  }, [isOpen]);

  const handleOpen = useCallback(() => {
    setClosing(false);
    setIsOpen(true);
    if (!chatId) {
      setShowWelcome(true);
    }
    openWidget();
  }, [openWidget, chatId]);

  const handleStartChat = useCallback(() => {
    setShowWelcome(false);
  }, []);

  const handleClose = useCallback(() => {
    setClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setClosing(false);
    }, 200);
  }, []);

  const handleSend = useCallback(() => {
    const content = inputValue.trim();
    if (!content) return;
    sendMessage(content);
    setInputValue('');
    sendTypingStop();
    textareaRef.current?.focus();
  }, [inputValue, sendMessage, sendTypingStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInputValue(e.target.value);
      if (e.target.value.trim()) {
        sendTypingStart();
      }
    },
    [sendTypingStart]
  );

  const handleInputBlur = useCallback(() => {
    sendTypingStop();
  }, [sendTypingStop]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await uploadFile(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [uploadFile]
  );

  const handleSubmitRating = useCallback(
    async (rating: number) => {
      if (!ratingChatId) return;
      setRatingValue(rating);
      setRatingSubmitted(true);
      try {
        await fetch(`/rate/${ratingChatId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rating }),
        });
      } catch (e) {
        console.error(e);
      }
      setTimeout(() => {
        setRatingChatId(null);
        setRatingSubmitted(false);
        resetChat();
      }, 2000);
    },
    [ratingChatId, resetChat]
  );

  if (!isOpen) {
    return (
      <button className="sw-open-btn" onClick={handleOpen}>
        <ChatIcon />
        {unread > 0 && (
          <span className={`sw-badge${unread > 0 ? ' sw-badge--visible' : ''}`}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  }

  const showRating = chatClosed && ratingChatId;
  const showInput = !chatClosed || !ratingChatId;
  const isOnline = connected && !operatorsOffline;
  const groups = groupMessages(messages);

  return (
    <div className={`sw-widget${closing ? ' sw-widget--closing' : ''}`}>
      <div className="sw-header">
        <div className="sw-header__info">
          <div className="sw-header__avatar">
            <ChatIcon />
          </div>
          <div className="sw-header__text">
            <span className="sw-header__title">Поддержка</span>
            <span className="sw-header__status">
              <span className={`sw-header__status-dot${isOnline ? ' sw-header__status-dot--online' : ' sw-header__status-dot--offline'}`} />
              {isOnline ? 'Онлайн' : 'Оффлайн'}
            </span>
          </div>
        </div>
        <div className="sw-header__actions">
          {chatId && !chatClosed && (
            <button
              className="sw-btn-finish"
              onClick={() => {
                if (confirm('Завершить чат?')) closeChat();
              }}
            >
              Завершить
            </button>
          )}
          <button className="sw-btn-close" onClick={handleClose}>
            ×
          </button>
        </div>
      </div>

      <div className="sw-messages">
        {showWelcome && !chatId && !operatorsOffline && (
          <div className="sw-welcome">
            <div className="sw-welcome__icon">
              <ChatIcon />
            </div>
            <p className="sw-welcome__title">Чем можем помочь?</p>
            <p className="sw-welcome__subtitle">Обычно отвечаем в течение нескольких минут</p>
            <button className="sw-welcome__btn" onClick={handleStartChat}>
              Начать чат
            </button>
          </div>
        )}

        {operatorsOffline && !chatId && (
          <div className="sw-offline">
            Все операторы сейчас офлайн.<br />Пожалуйста, попробуйте позже.
          </div>
        )}

        {showRating && (
          <div className="sw-rating">
            {ratingSubmitted ? (
              <div className="sw-rating__thanks">
                <div className="sw-rating__thanks-icon">
                  <CheckIcon />
                </div>
                <p className="sw-rating__thanks-text">Спасибо за оценку!</p>
              </div>
            ) : (
              <>
                <p className="sw-rating__text">Оцените качество обслуживания</p>
                <div className="sw-rating__stars">
                  {[1, 2, 3, 4, 5].map((v) => (
                    <button
                      key={v}
                      className={`sw-rating__star${
                        v <= (hoverRating || ratingValue) ? ' sw-rating__star--active' : ''
                      }`}
                      onClick={() => handleSubmitRating(v)}
                      onMouseEnter={() => setHoverRating(v)}
                      onMouseLeave={() => setHoverRating(0)}
                    >
                      ★
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {!chatClosed && !chatId && !operatorsOffline && !showWelcome && (
          <div className="sw-offline" style={{ color: '#94a3b8' }}>
            Подключение к оператору...
          </div>
        )}

        {groups.map((group) => {
          const firstMsg = messages[group.messages[0].idx];
          const showDate = shouldShowDateSeparator(messages, group.messages[0].idx);
          return (
            <div key={`${group.senderId}-${group.messages[0].id}`}>
              {showDate && firstMsg && (
                <div className="sw-date-separator">
                  <span className="sw-date-separator__text">{formatDate(firstMsg.created_at)}</span>
                </div>
              )}
              <div className={`sw-msg-group${group.senderId === 0 ? ' sw-msg-group--client' : ' sw-msg-group--operator'}`}>
                {group.senderId !== 0 && (
                  <div className="sw-msg__sender">{group.senderName}</div>
                )}
                {group.messages.map((gm) => {
                  const m = messages[gm.idx];
                  const isLast = gm === group.messages[group.messages.length - 1];
                  return (
                    <div key={gm.id}>
                      <div className={`sw-msg${m.sender_id === 0 ? ' sw-msg--client' : ' sw-msg--operator'}`}>
                        {m.message_type === 'image' && m.file_url ? (
                          <img
                            className="sw-msg__image"
                            src={m.file_url}
                            alt=""
                            onClick={() => window.open(m.file_url!, '_blank')}
                          />
                        ) : m.message_type === 'file' && m.file_url ? (
                          <a className="sw-msg__file" href={m.file_url} target="_blank" rel="noreferrer">
                            📎 {m.content || 'Файл'}
                          </a>
                        ) : (
                          m.content
                        )}
                      </div>
                      {isLast && (
                        <div className="sw-msg__time">{formatTime(m.created_at)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {isTyping && (
          <div className="sw-typing">
            <span className="sw-typing__dot" />
            <span className="sw-typing__dot" />
            <span className="sw-typing__dot" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showInput && (
        <div className="sw-input-area">
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.txt"
            onChange={handleFileSelect}
          />
          <button className="sw-btn-attach" onClick={() => fileInputRef.current?.click()} title="Прикрепить файл">
            <AttachIcon />
          </button>
          <textarea
            ref={textareaRef}
            className="sw-textarea"
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleInputBlur}
            onKeyDown={handleKeyDown}
            placeholder="Напишите сообщение..."
            rows={1}
          />
          <button className="sw-btn-send" onClick={handleSend}>
            <SendIcon />
          </button>
        </div>
      )}
    </div>
  );
}

function playNotifySound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

import { useState } from 'react';
import { Box } from '@mui/material';
import AdminSideNav from '@/components/admin/AdminSideNav';
import OperatorsPage from '@/components/admin/OperatorsPage';
import InvitesPage from '@/components/admin/InvitesPage';
import TagsPage from '@/components/admin/TagsPage';
import SettingsPage from '@/components/admin/SettingsPage';
import AuditPage from '@/components/admin/AuditPage';
import AdminStatsPage from '@/components/admin/AdminStatsPage';
import TelegramBotPage from '@/components/admin/TelegramBotPage';
import WidgetPage from '@/components/admin/WidgetPage';
import BillingPage from '@/components/admin/BillingPage';
import TicketTemplatesPage from '@/components/admin/TicketTemplatesPage';
import TicketsPage from '@/components/tickets/TicketsPage';
import FeatureLocked from '@/components/common/FeatureLocked';
import PaywallBanner from '@/components/common/PaywallBanner';
import { useAuthStore } from '@/stores/authStore';

type AdminPage = 'operators' | 'invites' | 'tags' | 'settings' | 'audit' | 'stats' | 'telegram' | 'widget' | 'billing' | 'ticket-templates' | 'tickets';

const PAGE_KEYS: AdminPage[] = ['operators', 'invites', 'tags', 'settings', 'audit', 'stats', 'telegram', 'widget', 'billing', 'ticket-templates', 'tickets'];

/** Ключ последнего открытого раздела панели. */
const PAGE_STORAGE_KEY = 'sc_admin_page';

/**
 * Раздел, на который возвращаемся при входе в панель: последний открытый.
 * Без этого любой возврат в /admin (перезагрузка, ссылка из операторской)
 * бросал админа на первый раздел — «Операторы», теряя контекст работы.
 */
function initialPage(billingActive: boolean): AdminPage {
  try {
    const saved = localStorage.getItem(PAGE_STORAGE_KEY);
    if (saved && (PAGE_KEYS as string[]).includes(saved)) return saved as AdminPage;
  } catch {
    /* localStorage недоступен — падаем на раздел по умолчанию */
  }
  return billingActive ? 'operators' : 'billing';
}

/** Copy for the upgrade placeholder shared by both ticket sections. */
const TICKETS_LOCK = {
  title: 'Тикет-система',
  description:
    'Сложные обращения не теряются в переписке: шаблоны с полями, статусы «решено» / «не решено», архив и статистика по тикетам.',
  requiredPlan: 'Профи',
};

export default function AdminPanel() {
  const billingActive = useAuthStore((s) => s.billingActive);
  const canUseTickets = useAuthStore((s) => s.canUseTickets);
  // A brand-new (unpaid) tenant lands straight on the billing section; paying
  // customers return to the section they left.
  const [page, setPage] = useState<AdminPage>(() => initialPage(billingActive));

  const openPage = (next: AdminPage) => {
    setPage(next);
    try {
      localStorage.setItem(PAGE_STORAGE_KEY, next);
    } catch {
      /* приватный режим — просто не запоминаем раздел */
    }
  };

  // Тикет-разделы доступны только на тарифах с тикет-системой: после смены
  // тарифа сохранённый раздел может стать заблокированным.
  const currentPage: AdminPage =
    !canUseTickets && (page === 'tickets' || page === 'ticket-templates') ? 'operators' : page;

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <AdminSideNav current={currentPage} onChange={openPage} />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!billingActive && currentPage !== 'billing' && <PaywallBanner onGoToBilling={() => openPage('billing')} />}
        <Box
          sx={{
            height: 52,
            bgcolor: 'background.paper',
            px: 3,
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid',
            borderColor: 'divider',
            fontWeight: 600,
            fontSize: 16,
            flexShrink: 0,
          }}
        >
          {pageTitles[currentPage]}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {currentPage === 'operators' && <OperatorsPage />}
          {currentPage === 'invites' && <InvitesPage />}
          {currentPage === 'tags' && <TagsPage />}
          {currentPage === 'settings' && <SettingsPage />}
          {currentPage === 'audit' && <AuditPage />}
          {currentPage === 'stats' && <AdminStatsPage />}
          {currentPage === 'telegram' && <TelegramBotPage />}
          {currentPage === 'widget' && <WidgetPage />}
          {currentPage === 'billing' && <BillingPage />}
          {currentPage === 'ticket-templates' &&
            (canUseTickets ? (
              <TicketTemplatesPage />
            ) : (
              <FeatureLocked {...TICKETS_LOCK} onUpgrade={() => openPage('billing')} />
            ))}
          {currentPage === 'tickets' &&
            (canUseTickets ? (
              <TicketsPage isAdmin />
            ) : (
              <FeatureLocked {...TICKETS_LOCK} onUpgrade={() => openPage('billing')} />
            ))}
        </Box>
      </Box>
    </Box>
  );
}

const pageTitles: Record<AdminPage, string> = {
  operators: 'Операторы',
  invites: 'Инвайт-коды',
  tags: 'Теги',
  settings: 'Настройки системы',
  audit: 'Аудит чатов',
  stats: 'Статистика по операторам',
  telegram: 'Telegram-бот',
  widget: 'Виджет на сайт',
  billing: 'Тариф и оплата',
  'ticket-templates': 'Шаблоны тикетов',
  tickets: 'Тикеты',
};
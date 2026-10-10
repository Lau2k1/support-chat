import { useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import OwnerSideNav from '@/components/owner/OwnerSideNav';
import CrmOverviewPage from '@/components/owner/CrmOverviewPage';
import CrmTenantsPage from '@/components/owner/CrmTenantsPage';
import CrmBotsPage from '@/components/owner/CrmBotsPage';
import CrmTenantDetail from '@/components/owner/CrmTenantDetail';

type OwnerPage = 'overview' | 'tenants' | 'bots';
type OwnerView = OwnerPage | 'tenant';

export default function OwnerDashboard() {
  const [params, setParams] = useSearchParams();
  const view = parseView(params.get('view'));
  const tenantId = Number(params.get('id')) || null;
  const page: OwnerPage = view === 'tenant' ? 'tenants' : view;

  const handleChange = (next: OwnerPage) => {
    setParams(next === 'overview' ? {} : { view: next }, { replace: true });
  };

  const title =
    view === 'overview'
      ? 'Кабинет владельца'
      : view === 'tenant'
        ? 'Управление клиентом'
        : view === 'tenants'
          ? 'Управление клиентами'
          : 'Telegram-боты';

  return (
    <Box sx={{ display: 'flex', height: '100vh' }}>
      <OwnerSideNav current={page} onChange={handleChange} />
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Box
          sx={{
            height: 52,
            bgcolor: '#fff',
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
          {title}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {view === 'overview' && <CrmOverviewPage />}
          {view === 'tenants' && <CrmTenantsPage />}
          {view === 'tenant' && tenantId != null && (
            <CrmTenantDetail
              tenantId={tenantId}
              onBack={() => setParams({ view: 'tenants' }, { replace: true })}
            />
          )}
          {view === 'tenant' && tenantId == null && (
            <CrmTenantsPage />
          )}
          {view === 'bots' && <CrmBotsPage />}
        </Box>
      </Box>
    </Box>
  );
}

function parseView(view: string | null): OwnerView {
  if (view === 'tenants' || view === 'bots' || view === 'tenant') return view;
  return 'overview';
}

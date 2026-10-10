import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import OwnerSideNav from '@/components/owner/OwnerSideNav';
import CrmOverviewPage from '@/components/owner/CrmOverviewPage';
import CrmTenantsPage from '@/components/owner/CrmTenantsPage';
import CrmBotsPage from '@/components/owner/CrmBotsPage';

type OwnerPage = 'overview' | 'tenants' | 'bots';

export default function OwnerDashboard() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<OwnerPage>(parseView(params.get('view')));

  useEffect(() => {
    setPage(parseView(params.get('view')));
  }, [params]);

  const handleChange = (next: OwnerPage) => {
    setPage(next);
    setParams(next === 'overview' ? {} : { view: next }, { replace: true });
  };

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
          {page === 'overview' ? 'Кабинет владельца' : page === 'tenants' ? 'Управление клиентами' : 'Telegram-боты'}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {page === 'overview' && <CrmOverviewPage />}
          {page === 'tenants' && <CrmTenantsPage />}
          {page === 'bots' && <CrmBotsPage />}
        </Box>
      </Box>
    </Box>
  );
}

function parseView(view: string | null): OwnerPage {
  if (view === 'tenants' || view === 'bots') return view;
  return 'overview';
}
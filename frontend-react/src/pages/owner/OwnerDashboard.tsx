import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Box } from '@mui/material';
import OwnerSideNav from '@/components/owner/OwnerSideNav';
import CrmOverviewPage from '@/components/owner/CrmOverviewPage';
import CrmTenantsPage from '@/components/owner/CrmTenantsPage';

type OwnerPage = 'overview' | 'tenants';

export default function OwnerDashboard() {
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState<OwnerPage>(params.get('view') === 'tenants' ? 'tenants' : 'overview');

  useEffect(() => {
    setPage(params.get('view') === 'tenants' ? 'tenants' : 'overview');
  }, [params]);

  const handleChange = (next: OwnerPage) => {
    setPage(next);
    setParams(next === 'tenants' ? { view: 'tenants' } : {}, { replace: true });
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
          {page === 'overview' ? 'Кабинет владельца' : 'Управление клиентами'}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', p: 3 }}>
          {page === 'overview' ? <CrmOverviewPage /> : <CrmTenantsPage />}
        </Box>
      </Box>
    </Box>
  );
}
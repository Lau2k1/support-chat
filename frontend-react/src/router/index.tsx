import { createBrowserRouter, Navigate } from 'react-router-dom';
import App from '@/App';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import OperatorDashboard from '@/pages/operator/OperatorDashboard';
import AdminPanel from '@/pages/admin/AdminPanel';
import OwnerDashboard from '@/pages/owner/OwnerDashboard';
import ProtectedRoute from '@/router/ProtectedRoute';
import { useAuthStore } from '@/stores/authStore';

/**
 * Role-owned home:
 *  - superadmin → owner CRM
 *  - tenant admin → tenant admin panel
 *  - operator → operator workspace
 */
function HomeRedirect() {
  const { isSuperadmin, isAdmin } = useAuthStore();
  if (isSuperadmin) return <Navigate to="/crm" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  return <Navigate to="/operator" replace />;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <Login />,
  },
  {
    path: '/register',
    element: <Register />,
  },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <App />
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'operator', element: <OperatorDashboard /> },
      { path: 'admin', element: <ProtectedRoute requireAdmin><AdminPanel /></ProtectedRoute> },
      { path: 'crm', element: <ProtectedRoute requireSuperadmin><OwnerDashboard /></ProtectedRoute> },
    ],
  },
]);
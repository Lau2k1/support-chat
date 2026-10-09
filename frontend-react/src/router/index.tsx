import { createBrowserRouter } from 'react-router-dom';
import App from '@/App';
import Login from '@/pages/Login';
import Register from '@/pages/Register';
import OperatorDashboard from '@/pages/operator/OperatorDashboard';
import AdminPanel from '@/pages/admin/AdminPanel';
import ProtectedRoute from '@/router/ProtectedRoute';

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
      { index: true, element: <OperatorDashboard /> },
      { path: 'admin', element: <ProtectedRoute requireAdmin><AdminPanel /></ProtectedRoute> },
    ],
  },
]);

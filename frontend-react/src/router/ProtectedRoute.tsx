import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

interface ProtectedRouteProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
  requireSuperadmin?: boolean;
}

export default function ProtectedRoute({ children, requireAdmin, requireSuperadmin }: ProtectedRouteProps) {
  const { isAuthenticated, isAdmin, isSuperadmin, authReady } = useAuthStore();

  // Wait for the initial /me probe before deciding: otherwise a page reload
  // would briefly look unauthenticated and bounce the user to /login.
  if (!authReady) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (requireSuperadmin && !isSuperadmin) {
    return <Navigate to="/" replace />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
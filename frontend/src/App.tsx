import { Routes, Route, Navigate } from 'react-router'
import { useAuth } from './hooks/useAuth'

import Library from './pages/Library'
import GameDetail from './pages/GameDetail'
import Login from './pages/Login'
import Register from './pages/Register'
import Admin from './pages/Admin'
import Account from './pages/Account'
import Header from './components/Header'
import { useGamepad } from './hooks/useGamepad'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, isAdmin } = useAuth()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function GuestRoute({ children }: { children: React.ReactNode }) {
  const { isLoggedIn } = useAuth()
  if (isLoggedIn) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  useGamepad()

  return (
    <div className="min-h-screen bg-grid">
      <Routes>
        <Route path="/login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="/register" element={<GuestRoute><Register /></GuestRoute>} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <>
                <Header />
                <Library />
              </>
            </ProtectedRoute>
          }
        />
        <Route
          path="/games/:id"
          element={
            <ProtectedRoute>
              <>
                <Header />
                <GameDetail />
              </>
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <>
                <Header />
                <Account />
              </>
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <>
                <Header />
                <Admin />
              </>
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

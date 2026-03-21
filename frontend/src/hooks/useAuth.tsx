import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import type { User, AuthResponse } from '../types/models'
import { api } from '../api/client'

interface AuthState {
  user: User | null
  token: string | null
  login: (username: string, password: string) => Promise<void>
  register: (username: string, password: string) => Promise<void>
  logout: () => void
  setToken: (token: string) => void
  setUser: (user: User) => void
  isAdmin: boolean
  isLoggedIn: boolean
}

const AuthContext = createContext<AuthState | null>(null)

function parseToken(token: string): User | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    const exp = payload.exp * 1000
    if (Date.now() > exp) return null
    return {
      id: Number(payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier']),
      username: payload['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
      role: (payload['http://schemas.microsoft.com/ws/2008/06/identity/claims/role'] as string).toLowerCase() as 'user' | 'admin',
      createdAt: '',
    }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'))
  const [user, setUser] = useState<User | null>(() => {
    const t = localStorage.getItem('token')
    return t ? parseToken(t) : null
  })

  useEffect(() => {
    if (token) {
      const parsed = parseToken(token)
      if (!parsed) {
        localStorage.removeItem('token')
        setToken(null)
        setUser(null)
      }
    }
  }, [token])

  const handleAuth = useCallback(async (endpoint: string, username: string, password: string) => {
    const res = await api.post<AuthResponse>(endpoint, { username, password })
    localStorage.setItem('token', res.token)
    setToken(res.token)
    setUser(res.user)
  }, [])

  const login = useCallback((username: string, password: string) =>
    handleAuth('/auth/login', username, password), [handleAuth])

  const register = useCallback((username: string, password: string) =>
    handleAuth('/auth/register', username, password), [handleAuth])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }, [])

  const updateToken = useCallback((newToken: string) => {
    localStorage.setItem('token', newToken)
    setToken(newToken)
  }, [])

  const updateUser = useCallback((newUser: User) => {
    setUser(newUser)
  }, [])

  return (
    <AuthContext value={{
      user,
      token,
      login,
      register,
      logout,
      setToken: updateToken,
      setUser: updateUser,
      isAdmin: user?.role === 'admin',
      isLoggedIn: !!user,
    }}>
      {children}
    </AuthContext>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

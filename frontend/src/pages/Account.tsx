import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { api } from '../api/client'
import type { AuthResponse } from '../types/models'
import { isSoundsEnabled, setSoundsEnabled } from '../utils/sounds'

export default function Account() {
  const { user, setToken, setUser } = useAuth()

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="font-display text-3xl font-bold text-text-primary mb-8">Account</h1>

      {/* Profile info */}
      <section className="card bg-surface rounded-xl ring-1 ring-border p-6 mb-6">
        <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Profile</h2>
        <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
          <span className="text-text-muted">Username</span>
          <span className="font-mono">{user?.username}</span>
          <span className="text-text-muted">Role</span>
          <span>
            <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
              user?.role === 'admin'
                ? 'bg-accent-dim text-accent'
                : 'bg-surface-raised text-text-secondary ring-1 ring-border'
            }`}>
              {user?.role}
            </span>
          </span>
          <span className="text-text-muted">Member since</span>
          <span>{user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</span>
        </div>
      </section>

      {/* Preferences */}
      <PreferencesSection />

      {/* Change password */}
      <ChangePasswordForm
        onSuccess={(res) => {
          setToken(res.token)
          setUser(res.user)
        }}
      />
    </main>
  )
}

function PreferencesSection() {
  const [soundsOn, setSoundsOn] = useState(isSoundsEnabled)

  return (
    <section className="card bg-surface rounded-xl ring-1 ring-border p-6 mb-6">
      <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Preferences</h2>
      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm text-text-primary">Navigation sounds</span>
        <button
          type="button"
          role="switch"
          aria-checked={soundsOn}
          onClick={() => {
            const next = !soundsOn
            setSoundsOn(next)
            setSoundsEnabled(next)
          }}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${soundsOn ? 'bg-accent' : 'bg-surface-raised ring-1 ring-border'}`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${soundsOn ? 'translate-x-5' : 'translate-x-0'}`}
          />
        </button>
      </label>
    </section>
  )
}

function ChangePasswordForm({ onSuccess }: { onSuccess: (res: AuthResponse) => void }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match')
      return
    }

    setLoading(true)
    try {
      const res = await api.put<AuthResponse>('/auth/change-password', {
        currentPassword,
        newPassword,
      })
      onSuccess(res)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card bg-surface rounded-xl ring-1 ring-border p-6">
      <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Change password</h2>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-sm">
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2.5">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-accent-dim border border-accent/20 rounded-lg px-4 py-2.5">
            <p className="text-accent text-sm">Password changed successfully.</p>
          </div>
        )}

        <div>
          <label htmlFor="current-password" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
          />
        </div>
        <div>
          <label htmlFor="new-password" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
          />
        </div>
        <div>
          <label htmlFor="confirm-new-password" className="block text-xs font-medium text-text-secondary mb-1.5 uppercase tracking-wider">
            Confirm new password
          </label>
          <input
            id="confirm-new-password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            minLength={8}
            className="input-field w-full bg-surface-raised border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="bg-accent hover:bg-accent-hover disabled:opacity-50 text-neutral-950 font-semibold px-5 py-2.5 rounded-lg transition text-sm"
        >
          {loading ? 'Changing...' : 'Change password'}
        </button>
      </form>
    </section>
  )
}

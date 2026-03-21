import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Game } from '../types/models'
import GameCard from '../components/GameCard'
import { useState } from 'react'
import { formatPlatform } from '../utils/platforms'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'

export default function Library() {
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState('')

  const { data: games = [], isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })

  const platforms = [...new Set(games.map((g) => g.platform))].sort()

  const filtered = games.filter((g) => {
    if (platform && g.platform !== platform) return false
    if (search && !g.title.toLowerCase().includes(search.toLowerCase()))
      return false
    return true
  })

  return (
    <main className="max-w-7xl mx-auto px-6 py-8">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 mb-8">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search games..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field w-full bg-surface border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition"
          />
        </div>
        <Listbox value={platform} onChange={setPlatform}>
          <div className="relative min-w-[160px]">
            <ListboxButton className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm text-left focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition flex items-center justify-between gap-2">
              <span>{platform ? formatPlatform(platform) : 'All platforms'}</span>
              <svg className="w-4 h-4 text-text-muted shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
              </svg>
            </ListboxButton>
            <ListboxOptions className="absolute z-20 mt-1 w-full max-h-60 overflow-auto rounded-lg bg-surface border border-border shadow-lg py-1 text-sm focus:outline-none">
              <ListboxOption
                value=""
                className="px-4 py-2 cursor-pointer data-[focus]:bg-surface-raised data-[selected]:text-accent transition-colors"
              >
                All platforms
              </ListboxOption>
              {platforms.map((p) => (
                <ListboxOption
                  key={p}
                  value={p}
                  className="px-4 py-2 cursor-pointer data-[focus]:bg-surface-raised data-[selected]:text-accent transition-colors"
                >
                  {formatPlatform(p)}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </div>
        </Listbox>
      </div>

      {/* Game count */}
      {!isLoading && (
        <p className="text-xs text-text-muted mb-4 font-mono">
          {filtered.length} {filtered.length === 1 ? 'game' : 'games'}
          {platform && ` in ${formatPlatform(platform)}`}
          {search && ` matching "${search}"`}
        </p>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="animate-pulse">
              <div className="aspect-[3/4] bg-surface-raised rounded-lg mb-2" />
              <div className="h-3 bg-surface-raised rounded w-3/4 mb-1.5" />
              <div className="h-2.5 bg-surface-raised rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-muted">
          <svg className="w-12 h-12 mb-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
          </svg>
          <p className="text-sm">No games found</p>
          <p className="text-xs mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {filtered.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}
    </main>
  )
}

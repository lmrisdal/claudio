import { Link } from 'react-router'
import type { Game } from '../types/models'
import { formatPlatform } from '../utils/platforms'

export default function GameCard({ game }: { game: Game }) {
  return (
    <Link to={`/games/${game.id}`} className={`group ${game.isMissing ? 'opacity-50' : ''}`}>
      <div className="aspect-[3/4] bg-surface-raised rounded-lg overflow-hidden mb-2 ring-1 ring-border group-hover:ring-accent/50 transition-all duration-200 relative">
        {game.isMissing && (
          <div className="absolute top-2 right-2 z-10 bg-red-500/90 text-white text-[10px] font-bold uppercase px-1.5 py-0.5 rounded">
            Missing
          </div>
        )}
        {game.coverUrl ? (
          <img
            src={game.coverUrl}
            alt={game.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-text-muted">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.4.604-.4.959v0c0 .333.277.599.61.58a48.1 48.1 0 005.427-.63 48.05 48.05 0 00.582-4.717.532.532 0 00-.533-.57v0c-.355 0-.676.186-.959.401-.29.221-.634.349-1.003.349-1.035 0-1.875-1.007-1.875-2.25s.84-2.25 1.875-2.25c.37 0 .713.128 1.003.349.283.215.604.401.959.401v0a.656.656 0 00.658-.663 48.422 48.422 0 00-.37-5.36c-1.886.342-3.81.574-5.766.689a.578.578 0 01-.61-.58v0z" />
            </svg>
            <span className="text-xs">No cover</span>
          </div>
        )}
      </div>
      <h3 className="text-sm font-medium truncate group-hover:text-accent transition-colors">
        {game.title}
      </h3>
      <p className="text-xs text-text-muted mt-0.5">{formatPlatform(game.platform)}{game.releaseYear ? ` · ${game.releaseYear}` : ''} · {game.installType === 'installer' ? 'Installer' : 'Portable'}</p>
    </Link>
  )
}

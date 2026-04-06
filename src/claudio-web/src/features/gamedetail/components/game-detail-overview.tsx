import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Game } from "../../core/types/models";
import { formatSize } from "../../core/utils/format";
import { formatPlatform } from "../../core/utils/platforms";
import { isPcPlatform } from "../shared";
import GameDetailOverviewDetailField from "./game-detail-overview-detail-field";

interface GameDetailOverviewProperties {
  game: Game;
  isAdmin: boolean;
  onBrowseFiles: () => void;
  children: ReactNode;
}

export default function GameDetailOverview({
  game,
  isAdmin,
  onBrowseFiles,
  children,
}: GameDetailOverviewProperties) {
  const aboutPreviewLines = 5;
  const aboutSummaryReference = useRef<HTMLParagraphElement>(null);
  const [isAboutExpanded, setIsAboutExpanded] = useState(false);
  const [aboutNeedsExpand, setAboutNeedsExpand] = useState(false);

  useEffect(() => {
    setIsAboutExpanded(false);
  }, [game.id, game.summary]);

  useEffect(() => {
    const evaluateSummaryOverflow = () => {
      const element = aboutSummaryReference.current;
      if (!element || isAboutExpanded) {
        return;
      }

      setAboutNeedsExpand(element.scrollHeight > element.clientHeight + 1);
    };

    const frame = requestAnimationFrame(evaluateSummaryOverflow);
    window.addEventListener("resize", evaluateSummaryOverflow);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", evaluateSummaryOverflow);
    };
  }, [game.summary, isAboutExpanded]);

  return (
    <>
      <div className="flex items-start gap-3 mb-3">
        <h1 className="font-display text-4xl font-bold text-text-primary">{game.title}</h1>
        {isAdmin && (
          <Link
            to={`/games/${game.id}/edit`}
            className="mt-2 shrink-0 p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-raised transition"
            title="Edit game"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"
              />
            </svg>
          </Link>
        )}
      </div>

      <div className="flex flex-wrap gap-2 mb-6">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
          <svg
            className="w-3 h-3 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25"
            />
          </svg>
          {formatPlatform(game.platform)}
        </span>
        {game.releaseYear && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
            {game.releaseYear}
          </span>
        )}
        {game.genre && (
          <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-medium text-text-secondary">
            {game.genre}
          </span>
        )}
        <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-surface-raised ring-1 ring-border text-xs font-mono text-text-secondary">
          {formatSize(game.sizeBytes)}
        </span>
        {isPcPlatform(game.platform) && (
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ring-1 ${
              game.installType === "installer"
                ? "bg-blue-500/10 ring-blue-500/20 text-blue-400"
                : "bg-accent-dim ring-accent/20 text-accent"
            }`}
          >
            {game.installType === "installer" ? "Installer" : "Portable"}
          </span>
        )}
        {game.igdbSlug && (
          <a
            href={`https://www.igdb.com/games/${game.igdbSlug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-purple-500/10 ring-1 ring-purple-500/20 text-xs font-medium text-purple-400 hover:bg-purple-500/20 transition"
          >
            IGDB
            <svg
              className="w-3 h-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
              />
            </svg>
          </a>
        )}
      </div>

      <div className="mb-8 -mt-4">
        <p className="text-xs text-text-muted font-mono">
          /{game.platform}/{game.folderName}
        </p>
        <button
          type="button"
          onClick={onBrowseFiles}
          className="inline-flex items-center gap-1 mt-2 text-xs text-text-muted hover:text-accent transition"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z"
            />
          </svg>
          Browse files
        </button>
      </div>

      {game.summary && (
        <div className="mb-8">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
            About
          </h2>
          <div className="relative">
            <p
              ref={aboutSummaryReference}
              className="text-text-secondary leading-relaxed"
              style={
                isAboutExpanded
                  ? undefined
                  : {
                      display: "-webkit-box",
                      WebkitLineClamp: aboutPreviewLines,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }
              }
            >
              {game.summary}
            </p>
            {!isAboutExpanded && aboutNeedsExpand && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-linear-to-t from-(--bg) to-transparent" />
            )}
          </div>
          {aboutNeedsExpand && (
            <button
              type="button"
              onClick={() => setIsAboutExpanded((expanded) => !expanded)}
              aria-expanded={isAboutExpanded}
              className="mt-2 text-xs text-accent hover:underline"
            >
              {isAboutExpanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}

      {(game.developer ||
        game.publisher ||
        game.gameMode ||
        game.series ||
        game.franchise ||
        game.gameEngine) && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 mb-8 text-sm">
          {game.developer && (
            <GameDetailOverviewDetailField label="Developer" value={game.developer} />
          )}
          {game.publisher && (
            <GameDetailOverviewDetailField label="Publisher" value={game.publisher} />
          )}
          {game.gameMode && (
            <GameDetailOverviewDetailField label="Game Mode" value={game.gameMode} />
          )}
          {game.gameEngine && (
            <GameDetailOverviewDetailField label="Engine" value={game.gameEngine} />
          )}
          {game.series && <GameDetailOverviewDetailField label="Series" value={game.series} />}
          {game.franchise && (
            <GameDetailOverviewDetailField label="Franchise" value={game.franchise} />
          )}
        </div>
      )}

      {children}
    </>
  );
}

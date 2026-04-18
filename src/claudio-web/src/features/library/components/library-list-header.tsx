type SortColumn = "platform" | "title" | "year" | "size";

type LibraryListHeaderProps = {
  sortBy: SortColumn;
  sortDir: "asc" | "desc";
  toggleSort: (column: SortColumn) => void;
};

export default function LibraryListHeader({ sortBy, sortDir, toggleSort }: LibraryListHeaderProps) {
  return (
    <div className="border-b border-border text-left text-xs text-text-muted tracking-wider mb-1">
      <div className="flex items-center py-2">
        <div className="w-25 pl-3 pr-4">
          <button
            onClick={() => toggleSort("platform")}
            className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
          >
            Platform
            {sortBy === "platform" && <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
          </button>
        </div>
        <div className="min-w-0 flex-1 pr-4">
          <button
            onClick={() => toggleSort("title")}
            className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
          >
            Title
            {sortBy === "title" && <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
          </button>
        </div>
        <div className="w-17.5 pr-4 hidden md:block">
          <button
            onClick={() => toggleSort("year")}
            className="hover:text-text-primary transition-colors inline-flex items-center gap-1"
          >
            Year
            {sortBy === "year" && <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
          </button>
        </div>
        <div className="w-50 pr-4 hidden lg:block">Genre</div>
        <div className="w-22.5 pr-3 hidden sm:block text-right">
          <button
            onClick={() => toggleSort("size")}
            className="hover:text-text-primary transition-colors inline-flex items-center gap-1 ml-auto"
          >
            Size
            {sortBy === "size" && <span>{sortDir === "asc" ? "\u2191" : "\u2193"}</span>}
          </button>
        </div>
        <div className="w-10 pr-3" />
      </div>
    </div>
  );
}

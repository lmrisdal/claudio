import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react";

export default function ExeListbox({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </label>
      <Listbox value={value} onChange={onChange}>
        <div className="relative mt-1">
          <ListboxButton className="w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:border-accent transition flex items-center justify-between gap-2">
            <span className="truncate">{value || "None"}</span>
            <svg
              className="w-4 h-4 text-text-muted shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
              />
            </svg>
          </ListboxButton>
          <ListboxOptions
            anchor="bottom start"
            className="z-20 w-(--button-width) max-h-48 overflow-auto rounded-lg bg-surface border border-border shadow-lg py-1 text-sm focus:outline-none"
          >
            <ListboxOption
              value=""
              className="px-3 py-2 cursor-pointer data-focus:bg-surface-raised data-selected:text-accent transition-colors"
            >
              None
            </ListboxOption>
            {options.map((exe) => (
              <ListboxOption
                key={exe}
                value={exe}
                className="px-3 py-2 cursor-pointer data-focus:bg-surface-raised data-selected:text-accent transition-colors truncate"
              >
                {exe}
              </ListboxOption>
            ))}
          </ListboxOptions>
        </div>
      </Listbox>
    </div>
  );
}

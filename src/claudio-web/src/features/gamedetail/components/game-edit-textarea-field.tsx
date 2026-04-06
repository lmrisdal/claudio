interface GameEditTextareaFieldProperties {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}

export default function GameEditTextareaField({
  label,
  value,
  rows,
  onChange,
}: GameEditTextareaFieldProperties) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </label>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={rows}
        className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-focus-ring transition resize-y"
      />
    </div>
  );
}

interface GameEditTextFieldProperties {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number";
  required?: boolean;
  placeholder?: string;
}

export default function GameEditTextField({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  placeholder,
}: GameEditTextFieldProperties) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        placeholder={placeholder}
        className="mt-1 w-full bg-surface-raised border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-focus-ring transition"
      />
    </div>
  );
}

interface GameDetailOverviewDetailFieldProperties {
  label: string;
  value: string;
}

export default function GameDetailOverviewDetailField({
  label,
  value,
}: GameDetailOverviewDetailFieldProperties) {
  return (
    <div>
      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">{label}</span>
      <p className="text-text-secondary mt-0.5">{value}</p>
    </div>
  );
}

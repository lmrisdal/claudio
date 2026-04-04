export default function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display font-bold tracking-wider ${className}`}>
      CLAUD<span className="text-accent">IO</span>
    </span>
  );
}

export default function AdminIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3l7.5 3v5.25c0 4.29-2.745 8.1-6.825 9.474a2.25 2.25 0 01-1.35 0C7.245 19.35 4.5 15.54 4.5 11.25V6L12 3z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 12l1.5 1.5 3-3.75" />
    </svg>
  );
}

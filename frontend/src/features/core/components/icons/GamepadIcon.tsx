export default function GamepadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 12h4m-2-2v4m5 0h.01M17 12h.01M15 16h.01M5.2 20h13.6c1.12 0 1.68 0 2.1-.22a2 2 0 0 0 .88-.87C22 18.48 22 17.92 22 16.8V11a6 6 0 0 0-6-6h-1l-1.5 2h-3L9 5H8a6 6 0 0 0-6 6v5.8c0 1.12 0 1.68.22 2.1a2 2 0 0 0 .87.88c.43.22.99.22 2.1.22Z"
      />
    </svg>
  );
}

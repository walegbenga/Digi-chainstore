// src/components/VerifiedBadge.tsx
// Reusable verified badge — use anywhere a seller or buyer name appears

interface VerifiedBadgeProps {
  type: 'seller' | 'buyer';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export default function VerifiedBadge({
  type,
  size = 'sm',
  showLabel = false,
}: VerifiedBadgeProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-6 w-6',
  };

  const label = type === 'seller' ? 'Verified Seller' : 'Verified Buyer';
  const color = type === 'seller' ? 'text-blue-500' : 'text-emerald-500';
  const bgColor = type === 'seller' ? 'bg-blue-50 text-blue-700 ring-blue-700/10' : 'bg-emerald-50 text-emerald-700 ring-emerald-700/10';

  if (showLabel) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${bgColor}`}>
        <svg
          className={`${sizeClasses[size]} ${color} flex-shrink-0`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.491 4.491 0 01-3.497-1.307 4.491 4.491 0 01-1.307-3.497A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.491 4.491 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
            clipRule="evenodd"
          />
        </svg>
        {label}
      </span>
    );
  }

  return (
    <svg
      className={`${sizeClasses[size]} ${color} inline-block flex-shrink-0`}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label={label}
    >
      <title>{label}</title>
      <path
        fillRule="evenodd"
        d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.497A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.491 4.491 0 01-3.497-1.307 4.491 4.491 0 01-1.307-3.497A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.491 4.491 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
        clipRule="evenodd"
      />
    </svg>
  );
}

// Hook to check verification status
// Usage: const { isVerifiedSeller, isVerifiedBuyer } = useVerification(address)

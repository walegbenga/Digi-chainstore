import React from 'react';

interface VerifiedBadgeProps {
  size?: 'sm' | 'md' | 'lg';
  level?: number;
  className?: string;
  label?: string;
  type?: 'seller' | 'buyer' | 'general';
  showLabel?: boolean;
}

const sizeClasses = { sm: 'w-4 h-4', md: 'w-5 h-5', lg: 'w-6 h-6' };

export default function VerifiedBadge({
  size = 'md',
  level = 1,
  className = '',
  label,
  type = 'general',
  showLabel = false,
}: VerifiedBadgeProps) {
  const color =
    level >= 3 ? 'text-yellow-500' :
    level >= 2 ? 'text-blue-500'   :
                 'text-indigo-500';

  const defaultLabel =
    type === 'seller' ? 'Verified Seller' :
    type === 'buyer'  ? 'Verified Buyer'  :
                        'Verified';

  const displayLabel = label || defaultLabel;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <svg
        className={`${sizeClasses[size]} ${color} inline-block flex-shrink-0`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-label={displayLabel}
        role="img"
      >
        <title>{displayLabel}</title>
        <path
          fillRule="evenodd"
          d="M8.603 3.799A4.49 4.49 0 0112 2.25c1.357 0 2.573.6 3.397 1.549a4.49 4.49 0 013.498 1.307 4.491 4.491 0 011.307 3.498A4.49 4.49 0 0121.75 12a4.49 4.49 0 01-1.549 3.397 4.491 4.491 0 01-1.307 3.497 4.491 4.491 0 01-3.497 1.307A4.49 4.49 0 0112 21.75a4.49 4.49 0 01-3.397-1.549 4.49 4.49 0 01-3.498-1.306 4.491 4.491 0 01-1.307-3.498A4.49 4.49 0 012.25 12c0-1.357.6-2.573 1.549-3.397a4.49 4.49 0 011.307-3.497 4.49 4.49 0 013.497-1.307zm7.007 6.387a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z"
          clipRule="evenodd"
        />
      </svg>
      {showLabel && (
        <span className={`text-xs font-semibold ${color}`}>
          {displayLabel}
        </span>
      )}
    </span>
  );
}

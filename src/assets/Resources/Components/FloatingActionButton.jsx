import { FaPlus } from 'react-icons/fa';

/**
 * Floating Action Button — circular plus button positioned at bottom-right.
 * Visible only on screens <= 1024px (same breakpoint as MobileNav).
 */
export default function FloatingActionButton({ onClick, style }) {
  return (
    <button
      type="button"
      className="fab-button"
      onClick={onClick}
      style={style}
      aria-label="Create new post"
    >
      <FaPlus />
    </button>
  );
}

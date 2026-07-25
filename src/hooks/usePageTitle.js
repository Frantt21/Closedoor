import { useEffect } from 'react';

const SITE_NAME = 'Closedoor';

export default function usePageTitle(title) {
  useEffect(() => {
    const base = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
    // Preserve any existing notification badge (e.g. "(3) ") set by
    // NotificationContext so it doesn't get lost on route navigation.
    const match = document.title.match(/^(\(\d+\)\s*)?/);
    document.title = (match && match[1]) ? `${match[1]}${base}` : base;
  }, [title]);
}

/**
 * Lightweight SVG icon components for the app shell.
 *
 * Purpose: Replace `react-icons/fa` imports in Header, MobileNav and RightPanel
 * so that the 26.9 KiB `vendor-icons` chunk is NOT loaded on the initial page.
 * Only these 11 SVG paths are inlined (~2.5 KiB total).
 */
import React from 'react';

function SvgIcon({ path, viewBox = '0 0 24 24', size = 20, ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={viewBox}
      fill="currentColor"
      style={{ display: 'block' }}
      {...props}
    >
      <path d={path} />
    </svg>
  );
}

export function IconHome(props) {
  return <SvgIcon path="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" {...props} />;
}

export function IconUser(props) {
  return (
    <SvgIcon
      path="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
      {...props}
    />
  );
}

export function IconBars(props) {
  return (
    <SvgIcon
      path="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"
      {...props}
    />
  );
}

export function IconBell(props) {
  return (
    <SvgIcon
      path="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"
      {...props}
    />
  );
}

export function IconCompass(props) {
  return (
    <SvgIcon
      path="M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z"
      {...props}
    />
  );
}

export function IconCog(props) {
  return (
    <SvgIcon
      path="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
      {...props}
    />
  );
}

export function IconComment(props) {
  return (
    <SvgIcon
      path="M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18z"
      {...props}
    />
  );
}

export function IconUsers(props) {
  return (
    <SvgIcon
      path="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
      {...props}
    />
  );
}

export function IconFire(props) {
  return (
    <SvgIcon
      path="M13.5.67s.74 2.65.74 4.8c0 2.06-1.35 3.73-3.41 3.73-2.07 0-3.63-1.67-3.63-3.73l.03-.36C5.21 7.51 4 10.62 4 14c0 4.42 3.58 8 8 8s8-3.58 8-8C20 8.61 17.41 3.8 13.5.67zM11.71 19c-1.78 0-3.22-1.4-3.22-3.14 0-1.62 1.05-2.76 2.81-3.12 1.77-.36 3.6-1.21 4.62-2.58.39 1.29.59 2.65.59 4.04 0 2.65-2.15 4.8-4.8 4.8z"
      viewBox="0 0 24 24"
      {...props}
    />
  );
}

export function IconHashtag(props) {
  const path = 'M7.59 21L10.4 3H12.8L10 21H7.59zM3.79 16L4.3 13H18.2L17.7 16H3.79zM2.5 11L3.01 8H16.91L16.4 11H2.5zM6.59 6L7.1 3H21L20.5 6H6.59z';
  return <SvgIcon path={path} {...props} />;
}

export function IconArrowRight(props) {
  return (
    <SvgIcon
      path="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"
      {...props}
    />
  );
}

export function IconNewspaper(props) {
  return (
    <SvgIcon
      path="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"
      {...props}
    />
  );
}

export function IconDownload(props) {
  return (
    <SvgIcon
      path="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"
      {...props}
    />
  );
}

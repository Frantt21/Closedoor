import React from 'react';
import './css/badge.css';

const ROLE_CONFIG = {
  admin: {
    className: 'role-badge--admin',
    label: 'Admin',
  },
  dev: {
    className: 'role-badge--dev',
    label: 'Dev',
  },
  mod: {
    className: 'role-badge--mod',
    label: 'Mod',
  },
  partner: {
    className: 'role-badge--partner',
    label: 'Partner',
  },
};

export default function Badge({ roles = ['user'] }) {
  const items = (Array.isArray(roles) ? roles : [roles])
    .map((r) => ROLE_CONFIG[r?.toLowerCase()])
    .filter(Boolean);

  if (items.length === 0) return null;

  return (
    <>
      {items.map((item) => (
        <span key={item.className} className={`role-badge ${item.className}`}>
          {item.label}
        </span>
      ))}
    </>
  );
}

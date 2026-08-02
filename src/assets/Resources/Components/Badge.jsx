import React from 'react';
import Tooltip from './Tooltip';
import './css/badge.css';

const ROLE_CONFIG = {
  admin: {
    className: 'role-badge--admin',
    img: '/admin_badge2.png',
    alt: 'Admin',
    tooltip: 'Admin',
  },
  dev: {
    className: 'role-badge--dev',
    img: '/dev_badge2.png',
    alt: 'Dev',
    tooltip: 'Dev',
  },
  mod: {
    className: 'role-badge--mod',
    label: 'Mod',
    tooltip: 'Mod',
  },
  partner: {
    className: 'role-badge--partner',
    img: '/partner_badge.png',
    alt: 'Partner',
    tooltip: 'Partner',
  },
  verified: {
    className: 'role-badge--verified',
    img: '/verified_badge2.png',
    alt: 'Verified',
    tooltip: 'Verified',
  },
};

export default function Badge({ roles = ['user'] }) {
  const items = (Array.isArray(roles) ? roles : [roles])
    .map((r) => ROLE_CONFIG[r?.toLowerCase()])
    .filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className="role-badges">
      {items.map((item) => (
        <Tooltip key={item.className} text={item.tooltip}>
          <span className={`role-badge ${item.className}`}>
            {item.img ? (
              <img 
                src={item.img} 
                alt={item.alt} 
                className="role-badge-img" 
                draggable={false}
                loading="lazy"
              />
            ) : (
              item.label
            )}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

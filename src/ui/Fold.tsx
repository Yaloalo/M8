import { useState } from 'react';

/**
 * On a phone the side panels stack under the grid and make the page very long, so they
 * fold. Folding only applies at phone width (CSS); on a desktop the panels are always open.
 */
export function useFold(name: string, openOnPhone: boolean) {
  const key = `fold:${name}`;
  const [open, setOpen] = useState(() => {
    try {
      const v = sessionStorage.getItem(key);
      return v == null ? openOnPhone : v === '1';
    } catch {
      return openOnPhone;
    }
  });
  const toggle = () =>
    setOpen((o) => {
      try {
        sessionStorage.setItem(key, o ? '0' : '1');
      } catch {
        /* Folding still works for this visit. */
      }
      return !o;
    });
  return { folded: !open, button: <FoldButton open={open} toggle={toggle} name={name} /> };
}

function FoldButton({ open, toggle, name }: { open: boolean; toggle: () => void; name: string }) {
  return (
    <button className="fold-toggle icon-button" aria-expanded={open} aria-label={`${open ? 'Fold' : 'Unfold'} ${name}`} onClick={toggle}>
      {open ? '−' : '+'}
    </button>
  );
}

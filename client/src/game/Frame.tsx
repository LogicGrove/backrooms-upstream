import type { KeyboardEvent, ReactNode } from 'react';

/*
 * El marco de las pantallas «grandes» (salas, logros, ajustes): cabecera con el título, las pestañas (si las hay) y BACK
 * a la derecha, y el contenido a todo el ancho debajo. Esc vuelve (lo decide Backrooms.tsx).
 */

export default function Frame<T extends string>({ title, tabs, tab, onTab, onBack, children }: { title: string; tabs?: readonly T[]; tab?: T; onTab?: (t: T) => void; onBack: () => void; children: ReactNode }) {
  // ← → recorren las pestañas y abren la que tocan; ↓ baja al contenido
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const all = [...e.currentTarget.querySelectorAll<HTMLElement>('.br-tab')], i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      const first = e.currentTarget.closest('.br-shell')?.querySelector<HTMLElement>('.br-body button:not(:disabled), .br-body input');
      if (first) (e.preventDefault(), first.focus());
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && i >= 0) {
      e.preventDefault();
      const n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
      n.focus();
      n.click();
    }
  };
  return (
    <div className="br-shell">
      <header className="br-top">
        <h1 className="br-top__title">{title}</h1>
        {tabs && (
          <div className="br-tabs" role="tablist" aria-label={title} onKeyDown={key}>
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" className="br-tab" aria-selected={t === tab} onClick={() => onTab?.(t)}>
                {t}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="br-opt br-back" onClick={onBack}>
          BACK
        </button>
      </header>
      <div className="br-body">{children}</div>
    </div>
  );
}

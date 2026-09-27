import { useEffect, useRef, type ReactNode } from 'react';

export type PersonalIconName = 'search' | 'arrow' | 'spark' | 'compare' | 'memory' | 'source' | 'close' | 'check' | 'external' | 'save' | 'known' | 'undo' | 'upload' | 'download' | 'more' | 'trash' | 'edit' | 'history' | 'stop';
const ICONS: Record<PersonalIconName, ReactNode> = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" /><path d="M20 2v4m-2-2h4" /></>,
  compare: <><rect x="3" y="5" width="7" height="14" rx="2" /><rect x="14" y="5" width="7" height="14" rx="2" /></>,
  memory: <><circle cx="12" cy="12" r="3" /><circle cx="5" cy="5" r="2" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="m6.5 6.5 3 3m5 5 3 3m0-11-3 3m-5 5-3 3" /></>,
  source: <><path d="M6 3h9l4 4v14H6V3Zm9 0v5h4M9 12h7m-7 4h7" /></>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  external: <><path d="M14 4h6v6m0-6L10 14" /><path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5" /></>,
  save: <path d="M6 3h12v18l-6-4-6 4V3Z" />,
  known: <><path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14" /></>,
  undo: <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12" />,
  upload: <path d="M12 15V3m-5 5 5-5 5 5M4 16v5h16v-5" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  trash: <><path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z" /></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6L3 9m0-6v6h6" /><path d="M12 7v5l3 2" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
};
export function PersonalIcon({ name, size = 18 }: { name: PersonalIconName; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[name]}</svg>;
}
export function PersonalDialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className={`vr-dialog p-dialog ${wide ? 'p-dialog-wide' : ''}`} onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} aria-label={title}>
    <div className="vr-dialog-head"><h2>{title}</h2><button className="vr-icon-button" onClick={onClose} aria-label="Close dialog"><PersonalIcon name="close" /></button></div>{children}
  </dialog>;
}
export function PersonalError({ error, dismiss }: { error: string; dismiss?: () => void }) {
  return error ? <div className="p-error" role="alert"><span>{error}</span>{dismiss && <button onClick={dismiss} aria-label="Dismiss error"><PersonalIcon name="close" size={16} /></button>}</div> : null;
}

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
export default function Modal({ title, onClose, children, className = '', footer, initialFocusSelector }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    if (initialFocusSelector) dialog.querySelector(initialFocusSelector)?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [initialFocusSelector]);
  return createPortal(<dialog ref={ref} className={'workspace-dialog ' + className} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const b = event.currentTarget.getBoundingClientRect();
      if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) onClose();
    }}>
    <header className="dialog-header"><div><span className="eyebrow">RECONAGENT WORKSPACE</span><h2>{title}</h2></div>
      <button className="icon-button" aria-label="Close dialog" onClick={onClose}><Icon name="close"/></button></header>
    <div className="dialog-body">{children}</div>{footer && <footer className="dialog-footer">{footer}</footer>}
  </dialog>, document.body);
}

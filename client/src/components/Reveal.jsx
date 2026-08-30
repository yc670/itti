import React, { useEffect, useRef, useState, cloneElement } from 'react';
import { useLocation } from 'react-router-dom';

/** Combines the wrapped child's existing ref (if it has one) with our own,
 * so wrapping something in <Reveal> never breaks a ref it was already
 * using for something else (e.g. scroll-spy section tracking). */
function mergeRefs(...refs) {
  return (node) => {
    refs.forEach((ref) => {
      if (!ref) return;
      if (typeof ref === 'function') ref(node);
      else ref.current = node;
    });
  };
}

/**
 * Wraps a single element and fades/slides it in the first time it
 * scrolls into view, instead of everything on the page just being
 * there on load. Stagger a group of these with increasing `delay`
 * values (e.g. i * 90) to get a cascading, one-after-another reveal
 * as the user scrolls down a page.
 *
 * Doesn't add any wrapping DOM node - the ref/className/style needed
 * to animate get merged directly onto the child via cloneElement, so
 * it's safe to drop into flex/grid layouts without disturbing them.
 *
 * Reveals once and stays revealed (doesn't re-hide on scroll away),
 * which is the usual expectation for this kind of effect and avoids
 * content flickering in and out while scrolling up and down.
 *
 * Scoped to an allowlist of pages ("/" and the Reports page/its browse
 * and publish sub-pages, plus Peer Review) - every <Reveal> elsewhere
 * in the app (there are ~24 pages using it) renders its child
 * immediately, fully visible, with no observer and no transition.
 * Rather than stripping <Reveal> out of every one of those call sites,
 * this one component just no-ops itself off the other pages, so the
 * cascading scroll-reveal effect only applies where it's been
 * explicitly opted into.
 */
const CASCADE_PATHS = ['/', '/reports', '/reports/browse', '/reports/publish', '/peer-review', '/peer-review/mine'];

export default function Reveal({ children, delay = 0 }) {
  const ownRef = useRef(null);
  const { pathname } = useLocation();
  const cascadeEnabled = CASCADE_PATHS.includes(pathname);
  const [visible, setVisible] = useState(!cascadeEnabled);

  useEffect(() => {
    if (!cascadeEnabled) {
      setVisible(true);
      return undefined;
    }

    const el = ownRef.current;
    if (!el) return undefined;

    // Respect reduced-motion users by just showing content immediately
    // rather than observing at all.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -10% 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [cascadeEnabled]);

  const child = React.Children.only(children);
  const mergedClassName = cascadeEnabled
    ? [child.props.className, 'reveal-on-scroll', visible ? 'is-visible' : ''].filter(Boolean).join(' ')
    : child.props.className;
  const mergedStyle = cascadeEnabled ? { ...child.props.style, transitionDelay: `${delay}ms` } : child.props.style;

  return cloneElement(child, {
    ref: mergeRefs(ownRef, child.ref),
    className: mergedClassName,
    style: mergedStyle
  });
}
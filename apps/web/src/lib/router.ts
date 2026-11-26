import { useEffect, useState } from 'react';

export interface Route {
  path: string;
  params: URLSearchParams;
  /** `#section` (sans slash) désigne une ancre de la page courante, pas une route. */
  isAnchor: boolean;
}

function parse(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart] = raw.split('?');
  const path = pathPart === '' ? '/' : pathPart;
  return {
    path,
    params: new URLSearchParams(queryPart ?? ''),
    isAnchor: !path.startsWith('/'),
  };
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function navigate(path: string) {
  if (window.location.hash === `#${path}`) return;
  window.location.hash = path;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  useEffect(() => {
    if (route.isAnchor) {
      const target = document.getElementById(route.path);
      target?.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'start',
      });
      return;
    }
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, [route.path, route.isAnchor]);
  return route;
}

/**
 * Fait défiler la page vers une ancre de section sans passer par le routeur.
 * L'URL est mise à jour (partage, rechargement) via `replaceState`, ce qui ne
 * déclenche ni `hashchange` ni rendu de route.
 */
export function scrollToSection(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  window.history.replaceState(null, '', `#${id}`);
  target.scrollIntoView({
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    block: 'start',
  });
  target.focus({ preventScroll: true });
}

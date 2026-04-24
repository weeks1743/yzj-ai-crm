import { brandTitle } from './brand';

export function applyDocumentBranding(title: string = brandTitle, iconHref?: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.title = title;

  if (!iconHref || !document.head) {
    return;
  }

  ['icon', 'shortcut icon', 'apple-touch-icon'].forEach((rel) => {
    let link = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;

    if (!link) {
      link = document.createElement('link');
      link.rel = rel;
      document.head.appendChild(link);
    }

    link.type = 'image/png';
    link.href = iconHref;
  });
}

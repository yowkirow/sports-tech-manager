// The page's canonical link and og:url name the page being viewed. Chrome on iOS shares the canonical
// link rather than the address bar, and the offline copy of the app carries the shop home's link.
export function setShareUrl(href) {
    for (const [selector, attribute] of [['link[rel="canonical"]', 'href'], ['meta[property="og:url"]', 'content']]) {
        const node = document.head.querySelector(selector);
        if (!node) continue;
        if (href) node.setAttribute(attribute, href);
        else node.remove();
    }
}

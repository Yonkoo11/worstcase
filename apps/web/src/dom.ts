/**
 * Build DOM nodes instead of concatenating HTML.
 *
 * The interface used to assemble markup as strings and assign it to innerHTML.
 * Every interpolation was escaped and a test walked the file to keep it that way,
 * but that is a convention enforced by a test: get one interpolation wrong and the
 * page executes whatever a chain returned. Three unescaped ones reached this
 * codebase before the test existed.
 *
 * Here a dynamic value cannot become markup. Strings passed as children become text
 * nodes, and attribute values go through setAttribute. There is no path from data to
 * an element or an event handler, so the class of bug is gone rather than detected.
 */

type AttributeValue = string | number | boolean | null | undefined;
export type Child = Node | string | number | null | undefined | false;

const SVG_NS = "http://www.w3.org/2000/svg";

function applyAttributes(element: Element, attributes: Record<string, AttributeValue>): void {
  for (const [name, value] of Object.entries(attributes)) {
    // false, null and undefined mean "omit", so callers can write conditions inline
    // rather than building attribute strings.
    if (value === false || value === null || value === undefined) continue;
    // true means a bare attribute: aria-current="" is not the same as absent, and
    // `data-replay` takes no value at all.
    element.setAttribute(name, value === true ? "" : String(value));
  }
}

function appendChildren(element: Element | DocumentFragment, children: readonly Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    // The important line in this file: a string is text, never markup.
    element.append(child instanceof Node ? child : String(child));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, AttributeValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  applyAttributes(element, attributes);
  appendChildren(element, children);
  return element;
}

/** SVG needs its own namespace or the browser renders an unknown inline element. */
export function s(tag: string, attributes: Record<string, AttributeValue> = {}, ...children: Child[]): SVGElement {
  const element = document.createElementNS(SVG_NS, tag) as SVGElement;
  applyAttributes(element, attributes);
  appendChildren(element, children);
  return element;
}

export function frag(...children: Child[]): DocumentFragment {
  const fragment = document.createDocumentFragment();
  appendChildren(fragment, children);
  return fragment;
}

/** Replace an element's contents without going through innerHTML. */
export function replaceChildren(target: Element, ...children: Child[]): void {
  target.replaceChildren();
  appendChildren(target, children);
}

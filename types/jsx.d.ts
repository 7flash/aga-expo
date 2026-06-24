declare namespace JSX {
  type Element = unknown;

  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>;
  }
}

// The verovio npm package ships no type declarations; these cover what kplayer uses.

declare module 'verovio/wasm' {
  export default function createVerovioModule(): Promise<unknown>;
}

declare module 'verovio/esm' {
  export class VerovioToolkit {
    constructor(module: unknown);
    getVersion(): string;
    setOptions(options: Record<string, unknown>): void;
    loadData(data: string): boolean;
    loadZipDataBuffer(data: ArrayBuffer): boolean;
    getPageCount(): number;
    renderToSVG(pageNo?: number, xmlDeclaration?: boolean): string;
    renderToMIDI(): string;
    renderToTimemap(options?: { includeMeasures?: boolean; includeRests?: boolean }): unknown[];
    getElementAttr(xmlId: string): Record<string, string>;
    getPageWithElement(xmlId: string): number;
    getLog(): string;
    getMEI(options?: Record<string, unknown>): string;
  }
}

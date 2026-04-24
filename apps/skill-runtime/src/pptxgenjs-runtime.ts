import PptxGenJSImport from 'pptxgenjs';

type PptxConstructor = new () => any;

const ResolvedPptxGenJS = (((PptxGenJSImport as unknown as { default?: PptxConstructor }).default)
  ?? (PptxGenJSImport as unknown as PptxConstructor));

export function createPptxGenJsInstance(): any {
  return new ResolvedPptxGenJS();
}

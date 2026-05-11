// PURPOSE: Type declarations for fast-formula-parser (no @types package available)
declare module 'fast-formula-parser' {
  interface CellRef {
    sheet: string;
    row: number;
    col: number;
  }

  interface RangeRef {
    from: { row: number; col: number };
    to: { row: number; col: number };
    sheet?: string;
  }

  interface ParserOptions {
    onCell?: (ref: CellRef) => number | string | boolean | null;
    onRange?: (ref: RangeRef) => (number | string | boolean | null)[][];
    onVariable?: (name: string, sheetName?: string) => CellRef | RangeRef;
    functions?: Record<string, (...args: unknown[]) => unknown>;
  }

  interface Position {
    row: number;
    col: number;
    sheet: string;
  }

  class FormulaParser {
    static MAX_ROW: number;
    static MAX_COLUMN: number;
    constructor(options?: ParserOptions);
    parse(formula: string, position: Position, allowArray?: boolean): unknown;
  }

  export const MAX_ROW: number;
  export const MAX_COLUMN: number;

  export default FormulaParser;
  export { FormulaParser };
}

declare module "fit-file-parser" {
  export default class FitParser {
    constructor(options?: Record<string, unknown>);
    parse(
      content: Buffer | ArrayBuffer,
      callback: (error: unknown, data: Record<string, unknown>) => void
    ): void;
  }
}

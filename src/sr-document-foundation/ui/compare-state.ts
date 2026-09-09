export class CompareGeneration {
  private generation = 0;
  next(): number { return ++this.generation; }
  accepts(generation: number): boolean { return generation === this.generation; }
}
export interface TextLine { number: number; text: string; ending: 'CRLF' | 'LF' | '끝 개행 없음' }
export function textPage(body: string, page: number, size = 200): { lines: TextLine[]; total: number } {
  const lines: TextLine[] = []; let start = 0; let number = 0;
  while (start < body.length) {
    const newline = body.indexOf('\n', start); const end = newline === -1 ? body.length : newline + 1; number++;
    if (number > page * size && number <= (page + 1) * size) { const raw = body.slice(start, end); const ending = raw.endsWith('\r\n') ? 'CRLF' : raw.endsWith('\n') ? 'LF' : '끝 개행 없음'; lines.push({ number, text: raw.replace(/\r?\n$/, ''), ending }); }
    start = end;
  }
  return { lines, total: number };
}

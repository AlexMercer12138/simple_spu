export function maskAssemblyComments(source: string): string[] {
  const maskedLines: string[] = [];
  let inBlockComment = false;
  for (const line of source.split(/\r?\n/)) {
    let masked = line;
    let searchFrom = 0;
    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end < 0) {
        maskedLines.push(' '.repeat(line.length));
        continue;
      }
      masked = ' '.repeat(end + 2) + masked.slice(end + 2);
      searchFrom = end + 2;
      inBlockComment = false;
    }
    while (true) {
      const start = line.indexOf('/*', searchFrom);
      if (start < 0) break;
      const end = line.indexOf('*/', start + 2);
      if (end < 0) {
        masked = masked.slice(0, start) + ' '.repeat(line.length - start);
        inBlockComment = true;
        break;
      }
      masked = masked.slice(0, start) + ' '.repeat(end + 2 - start) + masked.slice(end + 2);
      searchFrom = end + 2;
    }
    const lineComment = masked.indexOf('//');
    if (lineComment >= 0) {
      masked = masked.slice(0, lineComment) + ' '.repeat(masked.length - lineComment);
    }
    maskedLines.push(masked);
  }
  return maskedLines;
}

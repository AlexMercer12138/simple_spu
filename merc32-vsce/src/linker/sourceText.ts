export function maskAssemblyComments(source: string): string[] {
  const maskedLines: string[] = [];
  let inBlockComment = false;
  for (const line of source.split(/\r?\n/)) {
    const masked = line.split('');
    let inQuote = false;
    let escaped = false;
    for (let index = 0; index < line.length; index++) {
      if (inBlockComment) {
        masked[index] = ' ';
        if (line[index] === '*' && line[index + 1] === '/') {
          masked[index + 1] = ' ';
          index++;
          inBlockComment = false;
        }
        continue;
      }
      if (inQuote) {
        if (escaped) escaped = false;
        else if (line[index] === '\\') escaped = true;
        else if (line[index] === '"') inQuote = false;
        continue;
      }
      if (line[index] === '"') {
        inQuote = true;
        continue;
      }
      if (line[index] === '/' && line[index + 1] === '/') {
        masked.fill(' ', index);
        break;
      }
      if (line[index] === '/' && line[index + 1] === '*') {
        masked[index] = ' ';
        masked[index + 1] = ' ';
        index++;
        inBlockComment = true;
      }
    }
    maskedLines.push(masked.join(''));
  }
  return maskedLines;
}

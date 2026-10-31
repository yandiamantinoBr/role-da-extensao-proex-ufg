import { readdirSync, readFileSync } from 'node:fs';
export function localMigrations() {
  const directory = new URL('../drizzle/', import.meta.url);
  return readdirSync(directory).filter(name => name.endsWith('.sql')).sort().map(name => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }));
}
export async function readBackupPassword(input = process.stdin, output = process.stderr) {
  if (!input.isTTY) {
    let value = '';
    for await (const chunk of input) { value += chunk.toString('utf8'); if (Buffer.byteLength(value) > 1030) throw new Error('Frase de proteção inválida.'); }
    return value.replace(/\r?\n$/, '');
  }
  output.write('Frase de proteção (entrada oculta): ');
  const previousRaw = input.isRaw; input.setRawMode(true); input.resume();
  try {
    return await new Promise((done, reject) => {
      let value = '';
      const receive = chunk => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\u0003') { finish(); reject(new Error('Operação cancelada.')); return; }
          if (char === '\r' || char === '\n') { finish(); done(value); return; }
          if (char === '\u007f' || char === '\b') value = [...value].slice(0, -1).join('');
          else value += char;
          if (Buffer.byteLength(value) > 1024) { finish(); reject(new Error('Frase de proteção inválida.')); return; }
        }
      };
      function finish() { input.removeListener('data', receive); }
      input.on('data', receive);
    });
  } finally { input.setRawMode(previousRaw ?? false); input.pause(); output.write('\n'); }
}
export function backupArguments(args, allowed) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const name = args[index];
    if (!allowed.includes(name) || Object.prototype.hasOwnProperty.call(result, name)) throw new Error('Opção inválida; consulte --help. Não forneça senhas por argumento.');
    if (name === '--dry-run') result[name] = true;
    else { const value = args[++index]; if (!value || value.startsWith('--')) throw new Error('Opção incompleta; consulte --help.'); result[name] = value; }
  }
  return result;
}

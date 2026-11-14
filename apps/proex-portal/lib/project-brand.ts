export type ProjectBrand = 'role-da-extensao' | 'conpeex-2026';

const ROLE_PROJECT_ID = 'role-da-extensao';
const CONPEEX_2026_PROJECT_ID = 'ad875870-a443-4f47-9c06-5dd0a6178de0';

export function projectBrandFor(id: unknown, name: unknown, address: unknown): ProjectBrand | undefined {
  if (typeof name !== 'string') return;
  const title = name.normalize('NFC').trim().toLocaleLowerCase('pt-BR');
  const isRole = id === ROLE_PROJECT_ID && title === 'rolê da extensão';
  const isConpeex = id === CONPEEX_2026_PROJECT_ID &&
    (title === '23º conpeex' || title === '23º conpeex — congresso de pesquisa, ensino e extensão');
  if (!isRole && !isConpeex) return;
  if (isRole && (address == null || (typeof address === 'string' && !address.trim()))) return 'role-da-extensao';
  if (typeof address !== 'string') return;
  let source: URL;
  try { source = new URL(address); } catch { return; }
  if (source.username || source.password) return;
  const path = source.pathname.replace(/\/$/, '');
  if (isRole && source.origin === 'https://proex.ufg.br' &&
      (path === '/p/60194-role-da-extensao' || path === '/p/53193-role-da-extensao')) return 'role-da-extensao';
  if (isConpeex) {
    if (source.origin === 'https://23conpeex.plateia.ufg.br' && !path) return 'conpeex-2026';
    if (source.origin === 'https://ufg.br' && path === '/e/39456-23-congresso-de-pesquisa-ensino-e-extensao-conpeex') return 'conpeex-2026';
  }
}

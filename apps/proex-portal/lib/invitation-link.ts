const validCode = (code: string) => /^[A-Za-z0-9_-]{32,120}$/.test(code);

/** New links keep the invitation code out of the initial HTTP request. */
export function invitationShareLink(rawLink: string, origin: string): string {
  const link = new URL(rawLink);
  if (link.origin !== origin || link.pathname !== '/convite' || link.username || link.password) {
    throw new Error('Endereço de convite inválido.');
  }

  const code = readInvitationCode(link.search, link.hash);
  if (!code) throw new Error('Código de convite inválido.');
  return `${link.origin}/convite#${new URLSearchParams({ token: code })}`;
}

/** Accept the old query format as well as the new fragment. */
export function readInvitationCode(search: string, hash: string): string {
  const codes = [
    ...new URLSearchParams(search).getAll('token'),
    ...new URLSearchParams(hash.slice(1)).getAll('token'),
  ];
  return codes.length === 1 && validCode(codes[0]) ? codes[0] : '';
}

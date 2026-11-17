import styles from './role-link-groups.module.css';

/** Bloco de links da resposta direta (links da PROEX, Instagram e notícias), como o servidor envia. */
export type RoleLinkGroupView = { title: string; links: { text: string; url: string; readable: boolean }[] };

const MAX_GROUPS = 20, MAX_LINKS = 80;
/** Confere o formato vindo do servidor: só HTTPS, endereço curto e textos limitados. Formato estranho: nada aparece. */
export function roleLinkGroupsFrom(value: unknown): RoleLinkGroupView[] | undefined {
  if (!Array.isArray(value)) return undefined;
  let total = 0;
  const groups = value.slice(0, MAX_GROUPS).flatMap(raw => {
    if (!raw || typeof raw !== 'object' || typeof (raw as RoleLinkGroupView).title !== 'string' || !Array.isArray((raw as RoleLinkGroupView).links)) return [];
    const group = raw as RoleLinkGroupView;
    const links = group.links.flatMap(link => {
      if (!link || typeof link.text !== 'string' || typeof link.url !== 'string' || !link.text.trim() || link.text.length > 300 || link.url.length > 300 || !link.url.startsWith('https://') || total >= MAX_LINKS) return [];
      try { new URL(link.url); } catch { return []; }
      total++;
      return [{ text: link.text, url: link.url, readable: link.readable === true }];
    });
    return links.length ? [{ title: group.title.slice(0, 80), links }] : [];
  });
  return groups.length ? groups : undefined;
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** Blocos recolhíveis (só os 2 primeiros abertos); cada link abre em nova aba e mostra só o nome. */
export default function RoleLinkGroups({ groups }: { groups: RoleLinkGroupView[] }) {
  return <div className={styles.groups}>
    {groups.map((group, index) => <details key={`${index}-${group.title}`} className={styles.group} open={index < 2}>
      <summary className={styles.summary}><h3 className={styles.title}>{group.title}</h3><span className={styles.count}> · {group.links.length} {group.links.length === 1 ? 'link' : 'links'}</span></summary>
      <ul className={styles.list}>
        {group.links.map(link => <li key={link.url}>
          <a className={styles.link} href={link.url} target="_blank" rel="noopener noreferrer">
            <span className={styles.name}>{link.text}<span className="visually-hidden"> (abre em nova aba)</span><span aria-hidden="true"> ↗</span></span>
            <small className={styles.host}>{hostOf(link.url)}{link.readable ? '' : ' · site externo'}</small>
          </a>
        </li>)}
      </ul>
    </details>)}
  </div>;
}

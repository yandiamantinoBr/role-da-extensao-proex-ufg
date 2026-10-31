'use client';
import { useRef, useState } from 'react';
import { ExternalLink, Search, UserPlus } from 'lucide-react';
import { officialTeamPrefill, PROEX_TEAM, PROEX_TEAM_SECTORS, PROEX_TEAM_SOURCE, searchOfficialTeam, type OfficialTeamSelection } from '../../lib/catalog/proex-team';
import styles from './official-team-directory.module.css';
type Props = { onSelect?: (selection: OfficialTeamSelection) => void };
export default function OfficialTeamDirectory({ onSelect }: Props) {
  const [query, setQuery] = useState(''), [sector, setSector] = useState(''), [selected, setSelected] = useState('');
  const details = useRef<HTMLDetailsElement>(null);
  const people = searchOfficialTeam(query, sector);
  function choose(id: string) {
    const prefill = officialTeamPrefill(id); if (!prefill || !onSelect) return;
    onSelect({ ...prefill, selectionKey: crypto.randomUUID() }); setSelected(prefill.name);
    if (details.current) details.current.open = false;
  }
  return <section className={`p-section ${styles.directory}`} aria-label="Referência oficial da equipe PROEX">
    <div className="p-section-heading"><div><h2>Equipe publicada pela PROEX</h2><p>Referência de nomes, atuação e contatos institucionais. Escolha uma pessoa para preencher o convite; projeto e função são definidos separadamente.</p></div></div>
    <p className={styles.provenance}>Catálogo local verificado em <time dateTime={PROEX_TEAM_SOURCE.verifiedAt}>31/10/2026</time>. A página de origem informa atualização em {PROEX_TEAM_SOURCE.publishedUpdateLabel}. Esta lista não é consultada ao vivo.</p>
    <a className="p-text-link" href={PROEX_TEAM_SOURCE.url} target="_blank" rel="noreferrer">Conferir a fonte oficial <ExternalLink size={15}/></a>
    {selected && <p role="status" className={styles.result}>Seleção de {selected} disponível no formulário. <a href="#team-invite-form" className="p-text-link">Revisar projeto e função do convite</a></p>}
    <details ref={details}><summary className={styles.summary}>Consultar catálogo oficial ({PROEX_TEAM.length} pessoas)</summary>
    <div className={styles.filters}>
      <label className="p-field"><span>Buscar na equipe oficial</span><div className="p-search"><Search size={17}/><input value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="Nome, setor, atuação ou e-mail"/></div></label>
      <label className="p-field"><span>Setor publicado</span><select value={sector} onChange={event => setSector(event.target.value)}><option value="">Todos os setores</option>{PROEX_TEAM_SECTORS.map(value => <option value={value} key={value}>{value}</option>)}</select></label>
    </div>
    <p className={styles.result} role="status">{people.length} de {PROEX_TEAM.length} pessoas publicadas.</p>
    {people.length ? <ul className={styles.cards}>{people.map(person => {
      const canPrefill = officialTeamPrefill(person.id) !== null;
      return <li className={styles.card} key={person.id}><div className={styles.person}><h3>{person.name}</h3><p>{person.sector}</p><p className={styles.position}>{person.position ?? 'Atuação específica não informada na página'}</p><p className={styles.email}>{person.email}</p></div>
        {canPrefill ? onSelect && <button type="button" className="p-button p-button-subtle" onClick={() => choose(person.id)}><UserPlus size={16}/>Preencher convite</button> : <p className={styles.review}>O domínio está assim na fonte e precisa de conferência. Preenchimento desabilitado; confirme o contato sem adivinhar uma correção.</p>}
      </li>;
    })}</ul> : <p className="p-empty">Nenhuma pessoa publicada corresponde a essa busca. Consulte a fonte oficial para conferir mudanças na equipe.</p>}
    </details>
    <p className={styles.provenance}>Cargo e domínio de e-mail são referências de contato. Acesso depende do projeto e da função escolhidos no portal. Contatos de estruturas vinculadas têm listas próprias na fonte.</p>
  </section>;
}

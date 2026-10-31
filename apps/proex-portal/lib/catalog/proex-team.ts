// Public professional reference, manually checked against the official page.
// This is a local snapshot, never an identity source or an access grant.
export const PROEX_TEAM_SOURCE = Object.freeze({
  title: 'Equipe PROEX — Pró-Reitoria de Extensão da UFG',
  url: 'https://proex.ufg.br/p/equipe-proex',
  publishedUpdate: '2026-10-05',
  publishedUpdateLabel: '05/10/2026 às 16:43',
  verifiedAt: '2026-10-31',
  mode: 'verified_local_snapshot' as const,
});
export type OfficialTeamPerson = Readonly<{ id: string; name: string; sector: string; position: string | null; email: string; contactStatus: 'published' | 'needs-review' }>;
const person = (id: string, name: string, sector: string, position: string | null, email: string, contactStatus: OfficialTeamPerson['contactStatus'] = 'published'): OfficialTeamPerson => Object.freeze({ id, name, sector, position, email, contactStatus });
const coordination = 'Coordenações', journal = 'Revista UFG', cabinet = 'Gabinete PROEX', execult = 'ExeCult — Equipe Executiva da Cultura';
export const PROEX_TEAM: readonly OfficialTeamPerson[] = Object.freeze([
  person('luana-ribeiro', 'Luana Cássia Miranda Ribeiro', 'Pró-Reitoria de Extensão', 'Profª', 'luaufg@ufg.br'),
  person('adriana-souza', 'Adriana Régia Marques de Souza', 'Pró-Reitoria Adjunta de Extensão e Diretoria de Extensão', 'Profª', 'adriana_regia_souza@ufg.br'),
  person('leandro-rodrigues', 'Leandro Pinho Rodrigues', 'Diretoria de Articulação e Logística', null, 'leandroppr@ufg.br'),
  person('kevellyn-rodrigues', 'Kevellyn Rodrigues', coordination, 'Coordenação Administrativa', 'kevellynsantos@ufg.br'),
  person('nathalia-rodrigues', 'Nathália Rodrigues', coordination, 'Coordenação de Eventos Institucionais', 'natrosouza@ufg.br'),
  person('larissa-paolis', 'Larissa De Paolis da Silva', coordination, 'Coordenação de Ações de Extensão', 'larissapaolis@ufg.br'),
  person('isabela-fernandes', 'Isabela Wender Lourenço Fernandes', coordination, 'Coordenação de Acompanhamento de Editais', 'isabelawender@ufg.br'),
  person('sheila-oliveira', 'Sheila Santos de Oliveira', journal, 'Editora Chefe', 'sheilaoliv@ufg.br'),
  person('vitor-silva', 'Vitor Hiago Moreira da Silva', journal, 'Estagiário (Letras: Português)', 'vitorhiago@discente.ufg.br'),
  person('weller-dias', 'Weller César Dias', journal, 'Estagiário (Letras: Inglês)', 'wellercesar@discente.ufg.br'),
  person('adriana-cavalcante', 'Adriana Ferreira Cavalcante', cabinet, 'Secretaria Geral', 'adrianacavalcante@ufg.br'),
  person('ana-pinto', 'Ana Maria Pereira Pinto', cabinet, 'Assistente em Administração', 'ana.pinto@ufg.br'),
  person('eduardo-pacheco', 'Eduardo Oliveira Pacheco', cabinet, 'Técnico em Tecnologia da Informação', 'eduardo.pacheco@ufg.br'),
  person('eryka-clodes', 'Éryka Clodes', cabinet, 'Assessoria', 'erykaclodes@ufg.br'),
  person('helio-batista', 'Hélio Antônio Batista', cabinet, 'Núcleo de Atendimento', 'hbatista@ufg.br'),
  // The page also mentions Hélio's contact in parentheses here. It is not
  // Heliza's address and is intentionally not used to prefill her invitation.
  person('heliza-sousa', 'Heliza Mábily Teles de Sousa', cabinet, 'Estagiária (Design Gráfico)', 'helizasousa@discente.ufg.br'),
  person('isaac-saraiva', 'Isaac Antonio Maciel Saraiva', cabinet, 'Técnico em Assuntos Educacionais', 'isaac.saraiva@ufg.br'),
  person('maria-alecrim', 'Maria Eduarda Medeiros Alecrim', cabinet, 'Estagiária (Gestão da Informação)', 'maria_alecrim@discente.ufg.br'),
  person('nathalia-elias', 'Nathália Rezende Elias', cabinet, 'Estagiária (Relações Públicas)', 'nathaliarezende@discente.ufg.br'),
  // Preserve the published spelling. Do not invent an address by correcting a
  // suspected domain typo; this row remains searchable but cannot prefill.
  person('nathalia-magalhaes', 'Nathália Rezende Magalhães', cabinet, 'Estagiária (Relações Públicas)', 'nathalia_rezende@discete.ufg.br', 'needs-review'),
  person('amanda-prado', 'Amanda Prado', execult, null, 'pradoamanda@ufg.br'),
  person('anne-rocha', 'Anne Rocha', execult, null, 'annerocha@ufg.br'),
  person('edivaldo-muniz', 'Edivaldo Muniz', execult, null, 'muniz2@ufg.br'),
  person('eduardo-olimpio', 'Eduardo Olimpio', execult, null, 'eduardo.olimpio@ufg.br'),
  person('isadora-neiva', 'Isadora de Souza Neiva', execult, null, 'isadora_souza@ufg.br'),
  person('lucas-lopes', 'Lucas de Sousa Lopes', execult, null, 'lucaslopes2@ufg.br'),
  person('mateus-felipe', 'Mateus Felipe', execult, null, 'mateus.costa@ufg.br'),
  person('matheus-silva', 'Matheus Silva', execult, null, 'matheus_matheus@discente.ufg.br'),
  person('thamara-aquino', 'Thamara Aquino', execult, null, 'thamara@ufg.br'),
  person('victoria-miranda', 'Victória Miranda', execult, null, 'victoria.miranda@ufg.br'),
  person('weslley-lopes', 'Weslley Lopes', execult, null, 'weslley_lopes@ufg.br'),
]);
export const PROEX_TEAM_SECTORS: readonly string[] = Object.freeze([...new Set(PROEX_TEAM.map(entry => entry.sector))]);
export function isPublishedInstitutionalEmail(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 254 || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:ufg\.br|discente\.ufg\.br)$/i.test(value)) return false;
  return true;
}
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
export function searchOfficialTeam(query: string, sector = ''): readonly OfficialTeamPerson[] {
  const words = normalized(query.slice(0, 120)).trim().split(/\s+/).filter(Boolean);
  return PROEX_TEAM.filter(entry => (!sector || sector === entry.sector) && words.every(word => normalized(`${entry.name} ${entry.sector} ${entry.position ?? ''} ${entry.email}`).includes(word)));
}
export type OfficialTeamPrefill = Readonly<{ id: string; name: string; email: string; sourceUrl: string; verifiedAt: string }>;
export type OfficialTeamSelection = OfficialTeamPrefill & Readonly<{ selectionKey: string }>;
/** Pure projection. No user creation, invitations, role, project or domain authority. */
export function officialTeamPrefill(id: string): OfficialTeamPrefill | null {
  const entry = PROEX_TEAM.find(person => person.id === id);
  if (!entry || entry.contactStatus !== 'published' || !isPublishedInstitutionalEmail(entry.email)) return null;
  return Object.freeze({ id: entry.id, name: entry.name, email: entry.email, sourceUrl: PROEX_TEAM_SOURCE.url, verifiedAt: PROEX_TEAM_SOURCE.verifiedAt });
}

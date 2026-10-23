# Como a UFG organiza a extensão — e como o portal usa isso

Levantamento de 23/10/2026 em fontes oficiais. A lista completa de fontes está em `lib/catalog/ufg-unidades-2026.ts` e `lib/catalog/extensao-classificacao.ts`. Os dados de referência ficam nesses arquivos; as regras de negócio do portal não dependem de interpretá-los.

## Quem pode propor ações (unidades)

O catálogo tem **78 unidades e órgãos da UFG**, agrupados como na estrutura oficial (Portaria SIG nº 3115/2026):

| Grupo | Exemplos |
| --- | --- |
| Unidades Acadêmicas (30) | FACE, FIC, FL, FM, IESA, INF, EM, IAC, IIG… |
| Unidades Acadêmicas Especiais (3) | UAECH, UAECSA (Câmpus Goiás), IFSIT |
| Unidade de Ensino Básico | CEPAE |
| Pró-Reitorias (7) | PROEX, PROGRAD, PRPI, PRPG, PRAE, PROAD, PROPESSOAS |
| Secretarias (8) | SEACULT, SECOM, SIN, SRI, SETI… |
| Órgãos suplementares, museus, hospitais, comunicação e câmpus | CIAR, SIBi, CEGRAF, Museu Antropológico, Centro Cultural, HC-UFG, Rádio Universitária… |

Mudanças de 2026 já refletidas no catálogo:

- **CONSUNI 355/2026**: a PROEC passou a se chamar **PROEX**, e a cultura foi para a **SEACULT**.
- A **EMAC** foi dividida em Escola de Música (EM) e Instituto de Artes da Cena (IAC).
- Duas unidades novas: **IIG** (Cidade Ocidental) e **IFSIT**.
- Jataí e Catalão viraram universidades próprias (UFJ e UFCAT) e não aparecem.

Itens com dúvida nas fontes estão marcados com `uncertain` no catálogo.

**No portal**, as unidades aparecem agrupadas em todos os filtros e formulários. O pré-cadastro acontece sozinho na primeira visita da administração geral e também pode ser disparado em *Configurações → Catálogo institucional*. Ele é idempotente: unidades já cadastradas são preservadas e só recebem grupo, câmpus e página oficial quando esses campos estiverem vazios. A unidade organiza o projeto e **não concede acesso**. O acesso continua sendo dado por projeto, na Equipe.

## Modalidades (CONSUNI 39/2020)

| Modalidade | Regra na UFG |
| --- | --- |
| **Programa** | Ao menos 3 projetos com coordenadores diferentes; pode reunir cursos, eventos e serviços; de 3 a 10 anos |
| **Projeto** | De 1 a 5 anos; pode estar vinculado a um programa (“programa superior” no portal) |
| **Curso** | Ação pedagógica de no mínimo 8 horas |
| **Evento** | Apresentação ou exibição pública de conhecimento ou produto |
| **Prestação de serviço** | Trabalho oferecido a terceiros a partir de demanda |

“Produto” não é modalidade na UFG. Por isso fica fora da lista.

**No portal**, a modalidade é o campo *Modalidade da ação* (tipos de iniciativa). Curso e Prestação de Serviço foram acrescentados aos tipos existentes. A hierarquia programa → projeto usa o campo *Programa ou projeto superior*.

## Áreas temáticas e linhas de extensão (FORPROEX)

- **8 áreas temáticas**: Comunicação, Cultura, Direitos Humanos e Justiça, Educação, Meio Ambiente, Saúde, Tecnologia e Produção, Trabalho. Cada projeto pode ter uma área. Ela aparece como selo no cartão e filtra projetos, materiais, empréstimos, eventos e relatórios.
- **53 linhas de extensão** (01 a 53), opcionais. Não há confirmação de que o SIGAA da UFG exija a linha.

## Registro e acompanhamento na UFG (referência para a equipe)

- **Coordenação**: servidor ativo da UFG (docente ou técnico-administrativo).
- **Equipe**: a vice-coordenação pode ser externa. A equipe precisa ter ao menos um estudante.
- **Unidade proponente**: é sempre a lotação de quem coordena.
- **Fluxo no SIGAA**:
  1. Cadastro em Andamento.
  2. Submetido (análise da CAEX da unidade).
  3. Aguardando aprovação do Diretor.
  4. Aguardando avaliação da PROEX.
  5. Em Execução.
- **Relatórios**: relatório parcial anual e relatório final. Quem atrasa mais de 60 dias fica bloqueado para cadastrar novas ações.
- **Curricularização (ACEx)**: no mínimo 10% da carga horária do curso. O estudante só conta como integrante da equipe, nunca como público.
- **Cursos e eventos pagos**: no mínimo 10% das vagas gratuitas para pessoas em vulnerabilidade.

O portal **não substitui o SIGAA**: ele organiza a operação (materiais, empréstimos, eventos, registros e equipe) de ações que já estão cadastradas lá. Um campo de situação espelhando o fluxo do SIGAA pode ser acrescentado depois, se a equipe quiser acompanhar as etapas de aprovação no portal.

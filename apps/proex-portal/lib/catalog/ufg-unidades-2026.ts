// Gerado a partir da pesquisa em fontes oficiais (veja sources). Dados de referência, não operacionais.
const data = {
 "schemaVersion": 1,
 "verifiedAt": "2026-10-23",
 "notes": [
  "The Pró-Reitoria was renamed by Resolução CONSUNI nº 355, de 27/03/2026: 'Pró-Reitoria de Extensão e Cultura - PROEC' became 'Pró-Reitoria de Extensão - PROEX'. Culture moved to a new 'Secretaria de Arte e Cultura (SEACULT)'. Older normative texts (CONSUNI 39/2020, IN PROEC 01/2020, CEPEC 1699/2021, SIGAA manual 2025) still say PROEC; proec.ufg.br now redirects to proex.ufg.br.",
  "Authoritative structure source: Portaria SIG nº 3115, de 18/05/2026 (nova Estrutura Organizacional da UFG / SIORG). It already shows changes not yet reflected on the ufg.br 'Unidades e Órgãos' page: EMAC split into 'Escola de Música' (EM) and 'Instituto de Artes da Cena' (IAC, with Artes Cênicas, Dança, Teatro, Direção de Arte); FEFD appears as 'Faculdade de Educação Física'; new 'Instituto de Inovação em Gestão' (IIG, Cidade Ocidental); new 'Instituto de Formação Superior Indígena Takinahakỹ' (IFSIT).",
  "Count check: RIG/Relato Integrado de Gestão 2025 (published 2026) states 30 unidades acadêmicas + 3 unidades acadêmicas especiais + 1 unidade de ensino básico. The list below reproduces exactly 30 + 3 + 1 (CEPAE).",
  "Jataí (UFJ) and Catalão (UFCAT) are separate universities and are not listed by UFG anymore; excluded. Current UFG câmpus: Colemar Natal e Silva, Samambaia (Goiânia), Aparecida de Goiânia, Goiás (Cidade de Goiás), Cidade Ocidental, plus activities/centers in Caldas Novas and Firminópolis.",
  "Group value 'Unidade de Ensino Básico' (CEPAE) and 'Câmpus' were added beyond the suggested enum because UFG's own count treats them separately.",
  "Field 'parent' is informative only; where the SIORG table layout made the parent ambiguous it is flagged uncertain."
 ],
 "groupOrder": [
  "Unidade Acadêmica",
  "Unidade Acadêmica Especial",
  "Unidade de Ensino Básico",
  "Pró-Reitoria",
  "Secretaria",
  "Órgão Suplementar",
  "Museu/Centro Cultural",
  "Hospital",
  "Comunicação",
  "Câmpus",
  "Outro"
 ],
 "sources": [
  {
   "title": "UFG - Unidades e Órgãos",
   "url": "https://ufg.br/p/27412-unidades-e-orgaos",
   "usedFor": "Official list of academic units with acronyms and URLs, órgãos administrativos, centros"
  },
  {
   "title": "UFG - Câmpus",
   "url": "https://ufg.br/p/27153-campus",
   "usedFor": "List of current câmpus (Goiás, Cidade Ocidental, Colemar, Samambaia, Aparecida) and cities (Caldas Novas, Firminópolis)"
  },
  {
   "title": "UFG - Gestão (2026-2030)",
   "url": "https://ufg.br/p/62693-gestao-teste",
   "usedFor": "Current pró-reitorias and secretarias, including 'Pró-Reitoria de Extensão' and 'Secretaria de Arte e Cultura'"
  },
  {
   "title": "Portaria SIG nº 3115, de 18 de maio de 2026 - nova Estrutura Organizacional da UFG (SIORG)",
   "url": "https://files.cercomp.ufg.br/weby/up/1094/o/SEI_6202774_PORTARIA_SIG_3115_2026.pdf",
   "usedFor": "Authoritative organizational structure: all units, EM/IAC split, IIG, IFSIT, SEACULT, PROEX internal structure, Câmara Superior de Extensão e Cultura"
  },
  {
   "title": "Relato Integrado de Gestão UFG 2025 (RIG 2026)",
   "url": "https://files.cercomp.ufg.br/weby/up/1094/o/RIG_2026_final.pdf",
   "usedFor": "Unit directors list, organogram and acronym legend (PRAE, PROAD, PROEC, PROGRAD, PRPG, PRPI, PROPESSOAS, SDH, SECOM, SEINFRA, SECPLAN, SETI, SIN, SRI), counts 30 UA + 3 UAE + 1 UEB, campus list"
  },
  {
   "title": "Resolução CONSUNI nº 355/2026 - altera denominação da PROEC para PROEX",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/SEI_6114898_Resolucao_355__de_27_de_marco_de_2026.pdf",
   "usedFor": "Renaming PROEC -> PROEX"
  },
  {
   "title": "Resolução CONSUNI nº 39/2020 - Regulamento das Ações de Extensão e Cultura da UFG",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/Resolucao_CONSUNI_2020_0039_%281%29.pdf",
   "usedFor": "UFG modalidades and definitions, coordination rules, CAEX, approval flow, reports, financing"
  },
  {
   "title": "Resolução CEPEC nº 1699/2021 - Atividades Curriculares de Extensão (ACEx)",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/Resolucao_CEPEC_2021_1699.pdf",
   "usedFor": "Curricularização da extensão at UFG; who may propose ACEx; TAE-coordinated ACEx rule"
  },
  {
   "title": "Instrução Normativa PROEC nº 01/2020 - atribuições das CAEX",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/Instruc%CC%A7a%CC%83o_Normativa_1_-_PROEC_-_SEI_23070.023700_2020_04.pdf",
   "usedFor": "CAEX composition and duties; one CAEX per unit/UAE/órgão; Coordenação de Extensão e Cultura do Câmpus Goiás"
  },
  {
   "title": "Instrução Normativa PROEC nº 04/2021 - prorrogação de ações de extensão",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/Instru%C3%A7%C3%A3o_Normativa_PROEC_04.2021_-_SEI_23070.010953_2021_91.pdf",
   "usedFor": "Classification with/without financing; status 'Em Execução'; extension rules"
  },
  {
   "title": "Manual da Extensão 2025 (SIGAA Módulo Extensão) - PROEC/UFG",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/manual_da_extens%C3%A3o_2025_revisado.pdf",
   "usedFor": "SIGAA statuses and flow, required fields, team roles by bond, reports/pendências, certificates, duplication"
  },
  {
   "title": "PROEX/UFG - Documentos Normativos",
   "url": "https://proex.ufg.br/p/24526-documentos-normativos",
   "usedFor": "Index of normative documents"
  },
  {
   "title": "PROEX/UFG - home and menu",
   "url": "https://proex.ufg.br/",
   "usedFor": "Current PROEX name, structure links (CAEX, CEC, Casa Projetos Sociais, Centro de Cultura e Eventos, Revista UFG), SIGAA, ACEx"
  },
  {
   "title": "Organograma PROEX v5.0.3 (28/07/2026)",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/Estrutura_Organizacional_-_2026.pdf",
   "usedFor": "PROEX internal structure"
  },
  {
   "title": "SEACULT - Secretaria de Arte e Cultura",
   "url": "https://seacult.ufg.br/",
   "usedFor": "Cultural bodies: Centro Cultural UFG, Museu Antropológico, Museu de Ciências (incl. Planetário and other nuclei)"
  },
  {
   "title": "Câmpus Goiás",
   "url": "https://goias.ufg.br/",
   "usedFor": "UAECH and UAECSA, Coordenação de Cultura e Extensão do Câmpus Goiás"
  },
  {
   "title": "Regimento Interno do IIG",
   "url": "https://files.cercomp.ufg.br/weby/up/1525/o/Regimento_Interno_do_IIG.pdf",
   "usedFor": "IIG as Unidade Acadêmica (Portaria SIG 2168/2025), Cidade Ocidental; unit council approves extension for PROEC validation"
  },
  {
   "title": "Relatório DAAF 2025 (indígenas)",
   "url": "https://files.cercomp.ufg.br/weby/up/1330/o/relatorio_-_DAAF_-_para_site_-2025-INDIGENAS.pdf",
   "usedFor": "Núcleo Takinahakỹ transformed into Unidade Acadêmica Especial 'Instituto de Formação Superior Indígena Takinahakỹ' (2025)"
  },
  {
   "title": "Anexo II - Unidades por Área, Câmpus Colemar Natal e Silva (2026)",
   "url": "https://files.cercomp.ufg.br/weby/up/1/o/Anexo_II_Unidades_por_Area_Dedetizacao_2026_%281%29.pdf",
   "usedFor": "Campus location of Colemar units (FF, FD, FE, FO, FEN, FANUT, FM, IPTSP, engineering blocks, Museu Antropológico, Planetário, Rádio Universitária)"
  },
  {
   "title": "Anexo IV - Unidades por Zona, Câmpus Samambaia (2026)",
   "url": "https://files.cercomp.ufg.br/weby/up/1/o/Anexo_IV_Unidades_por_Zona_Campus_Samambaia_Dedetizacao_2026.pdf",
   "usedFor": "Campus location of Samambaia units"
  },
  {
   "title": "FORPROEX - Política Nacional de Extensão Universitária (2012), hosted by PROEX/UFG",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/Pol%C3%ADtica-Nacional-de-Extens%C3%A3o-Universit%C3%A1ria.pdf",
   "usedFor": "Concept and diretrizes (interação dialógica, interdisciplinaridade e interprofissionalidade, indissociabilidade, impacto na formação, impacto e transformação social)"
  },
  {
   "title": "FORPROEX - Extensão Universitária: Organização e Sistematização (Coopmed, 2007)",
   "url": "https://proex.uneb.br/wp-content/uploads/2022/02/Organizacao-e-Sistematizacao.pdf",
   "usedFor": "8 áreas temáticas (Quadro 2), 53 linhas de extensão (Quadros 3-4), definitions of programa/projeto/curso/evento/prestação de serviço, course/event/service subtypes, publicações e produtos"
  },
  {
   "title": "Resolução CNE/CES nº 7/2018 - Diretrizes para a Extensão na Educação Superior Brasileira (hosted by PROEX/UFG)",
   "url": "https://files.cercomp.ufg.br/weby/up/694/o/rces007_18_-_MEC_CNE.pdf",
   "usedFor": "National modalidades (programas, projetos, cursos e oficinas, eventos, prestação de serviços) and 10% curricular minimum"
  }
 ],
 "units": [
  {
   "key": "ea",
   "name": "Escola de Agronomia",
   "acronym": "EA",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.agro.ufg.br/"
  },
  {
   "key": "eeca",
   "name": "Escola de Engenharia Civil e Ambiental",
   "acronym": "EECA",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://www.eec.ufg.br/",
   "uncertain": true,
   "notes": "Campus inferred: engineering blocks are listed in the Colemar Natal e Silva area annex (2026) without naming the school."
  },
  {
   "key": "emc",
   "name": "Escola de Engenharia Elétrica, Mecânica e de Computação",
   "acronym": "EMC",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://www2.emc.ufg.br/",
   "uncertain": true,
   "notes": "Campus inferred (engineering blocks in Colemar annex; not listed in Samambaia annex)."
  },
  {
   "key": "em",
   "name": "Escola de Música",
   "acronym": "EM",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://em.ufg.br/",
   "notes": "Formerly part of Escola de Música e Artes Cênicas (EMAC). Portaria SIG 3115/2026 lists 'ESCOLA DE MÚSICA' / 'VICE-DIRETORIA EM'; the site footer says 'Escola de Música'. ufg.br/p/27412 and RIG 2025 still show 'Escola de Música e Artes Cênicas (EMAC)'. Projects registered before the split may carry EMAC."
  },
  {
   "key": "evz",
   "name": "Escola de Veterinária e Zootecnia",
   "acronym": "EVZ",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://evz.ufg.br/"
  },
  {
   "key": "face",
   "name": "Faculdade de Administração, Ciências Contábeis e Ciências Econômicas",
   "acronym": "FACE",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.face.ufg.br/"
  },
  {
   "key": "fav",
   "name": "Faculdade de Artes Visuais",
   "acronym": "FAV",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.fav.ufg.br/"
  },
  {
   "key": "fct",
   "name": "Faculdade de Ciências e Tecnologia",
   "acronym": "FCT",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Aparecida de Goiânia",
   "officialUrl": "https://www.fct.ufg.br/",
   "notes": "RIG 2025 spells 'Faculdade de Ciência e Tecnologia'; the units page and Portaria 3115/2026 use 'Ciências e Tecnologia'."
  },
  {
   "key": "fcs",
   "name": "Faculdade de Ciências Sociais",
   "acronym": "FCS",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.cienciassociais.ufg.br/"
  },
  {
   "key": "fd",
   "name": "Faculdade de Direito",
   "acronym": "FD",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://direito.ufg.br/"
  },
  {
   "key": "fe",
   "name": "Faculdade de Educação",
   "acronym": "FE",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://fe.ufg.br/",
   "notes": "Also houses Psicologia and the Centro de Ensino, Pesquisa e Extensão do Adolescente (CEPEA)."
  },
  {
   "key": "fefd",
   "name": "Faculdade de Educação Física",
   "acronym": "FEFD",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://fef.ufg.br/",
   "uncertain": true,
   "notes": "Historically 'Faculdade de Educação Física e Dança (FEFD)'. Portaria 3115/2026 names it 'Faculdade de Educação Física' but keeps 'FEFD' in sub-unit labels; fefd.ufg.br redirects to fef.ufg.br, whose header still says FEFD and footer says 'FEF - Faculdade de Educação Física'. Treat FEFD/FEF as aliases until UFG settles it."
  },
  {
   "key": "fen",
   "name": "Faculdade de Enfermagem",
   "acronym": "FEN",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://www.fen.ufg.br/"
  },
  {
   "key": "ff",
   "name": "Faculdade de Farmácia",
   "acronym": "FF",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://farmacia.ufg.br/"
  },
  {
   "key": "fafil",
   "name": "Faculdade de Filosofia",
   "acronym": "FAFIL",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.filosofia.ufg.br/"
  },
  {
   "key": "fh",
   "name": "Faculdade de História",
   "acronym": "FH",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.historia.ufg.br/"
  },
  {
   "key": "fic",
   "name": "Faculdade de Informação e Comunicação",
   "acronym": "FIC",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.fic.ufg.br/"
  },
  {
   "key": "fl",
   "name": "Faculdade de Letras",
   "acronym": "FL",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://letras.ufg.br/"
  },
  {
   "key": "fm",
   "name": "Faculdade de Medicina",
   "acronym": "FM",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://www.medicina.ufg.br/"
  },
  {
   "key": "fanut",
   "name": "Faculdade de Nutrição",
   "acronym": "FANUT",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://fanut.ufg.br/"
  },
  {
   "key": "fo",
   "name": "Faculdade de Odontologia",
   "acronym": "FO",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://odonto.ufg.br/"
  },
  {
   "key": "iac",
   "name": "Instituto de Artes da Cena",
   "acronym": "IAC",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "",
   "uncertain": true,
   "notes": "New unit in Portaria SIG 3115/2026 (courses: Artes Cênicas, Dança, Teatro, Direção de Arte; PPG em Artes da Cena). Came out of EMAC; Dança appears to have moved from FEFD. No own website found; campus assumed from former EMAC building (Samambaia)."
  },
  {
   "key": "icb",
   "name": "Instituto de Ciências Biológicas",
   "acronym": "ICB",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.icb.ufg.br/"
  },
  {
   "key": "iesa",
   "name": "Instituto de Estudos Socioambientais",
   "acronym": "IESA",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.iesa.ufg.br/",
   "notes": "Portaria 3115/2026 places 'Diretoria do Planetário' under IESA."
  },
  {
   "key": "if",
   "name": "Instituto de Física",
   "acronym": "IF",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.if.ufg.br/"
  },
  {
   "key": "inf",
   "name": "Instituto de Informática",
   "acronym": "INF",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "http://www.inf.ufg.br/"
  },
  {
   "key": "iig",
   "name": "Instituto de Inovação em Gestão",
   "acronym": "IIG",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Cidade Ocidental",
   "officialUrl": "https://co.ufg.br/",
   "notes": "Created by Portaria SIG nº 2168 de 22/04/2025; URL is the câmpus site (no separate IIG site found). Has its own Coordenação de Extensão e Cultura (CAEX) per its regimento."
  },
  {
   "key": "ime",
   "name": "Instituto de Matemática e Estatística",
   "acronym": "IME",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://mat.ufg.br/"
  },
  {
   "key": "iptsp",
   "name": "Instituto de Patologia Tropical e Saúde Pública",
   "acronym": "IPTSP",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://iptsp.ufg.br/"
  },
  {
   "key": "iq",
   "name": "Instituto de Química",
   "acronym": "IQ",
   "kind": "academic",
   "group": "Unidade Acadêmica",
   "campus": "Campus Samambaia",
   "officialUrl": "https://quimica.ufg.br/"
  },
  {
   "key": "ifsit",
   "name": "Instituto de Formação Superior Indígena Takinahakỹ",
   "acronym": "IFSIT",
   "kind": "academic",
   "group": "Unidade Acadêmica Especial",
   "campus": "Campus Samambaia",
   "officialUrl": "",
   "uncertain": true,
   "notes": "Former Núcleo Takinahakỹ (Faculdade de Letras), turned into a Unidade Acadêmica Especial in 2025 per UFG/DAAF reports; acronym 'IFSIT' taken from Portaria 3115/2026 ('COORDENAÇÃO ADMINISTRATIVA IFSIT'). Campus inferred from 'Núcleo Takinahaky' in Samambaia zone annex. Course: Educação Intercultural."
  },
  {
   "key": "uaech",
   "name": "Unidade Acadêmica Especial de Ciências Humanas",
   "acronym": "UAECH",
   "kind": "academic",
   "group": "Unidade Acadêmica Especial",
   "campus": "Cidade de Goiás",
   "officialUrl": "https://uaech.goias.ufg.br/",
   "notes": "Courses: Filosofia, Pedagogia, Educação do Campo. Acronym used in UFG documents and subdomain."
  },
  {
   "key": "uaecsa",
   "name": "Unidade Acadêmica Especial de Ciências Sociais Aplicadas",
   "acronym": "UAECSA",
   "kind": "academic",
   "group": "Unidade Acadêmica Especial",
   "campus": "Cidade de Goiás",
   "officialUrl": "https://csa.goias.ufg.br/",
   "notes": "Courses: Administração, Arquitetura e Urbanismo, Direito, Serviço Social."
  },
  {
   "key": "cepae",
   "name": "Centro de Ensino e Pesquisa Aplicada à Educação",
   "acronym": "CEPAE",
   "kind": "academic",
   "group": "Unidade de Ensino Básico",
   "campus": "Campus Samambaia",
   "officialUrl": "https://www.cepae.ufg.br/",
   "notes": "UFG's 'unidade de ensino básico'; explicitly allowed to propose ACEx by CEPEC 1699/2021 art. 9."
  },
  {
   "key": "proad",
   "name": "Pró-Reitoria de Administração e Finanças",
   "acronym": "PROAD",
   "kind": "agency",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://proad.ufg.br/"
  },
  {
   "key": "prae",
   "name": "Pró-Reitoria de Assuntos Estudantis",
   "acronym": "PRAE",
   "kind": "agency",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://prae.ufg.br/"
  },
  {
   "key": "proex",
   "name": "Pró-Reitoria de Extensão",
   "acronym": "PROEX",
   "kind": "proex",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://proex.ufg.br/",
   "notes": "Until 27/03/2026: Pró-Reitoria de Extensão e Cultura (PROEC). Internal structure (organograma v5.0.3, 28/07/2026): Câmara de Extensão e Cultura (CEC); Diretoria de Extensão (Coordenação de Ações de Extensão; Coordenação Casa Projetos Sociais); Diretoria de Articulação e Logística (Coordenação de Acompanhamento de Editais; Coordenação de Eventos Institucionais; Coordenação Centro de Cultura e Eventos); Coordenação Administrativa; Revista UFG. Portaria 3115/2026 also lists a Coordenação de Formação em Extensão and a Câmara Regional de Extensão e Cultura - Goiânia."
  },
  {
   "key": "propessoas",
   "name": "Pró-Reitoria de Gestão de Pessoas",
   "acronym": "PROPESSOAS",
   "kind": "agency",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://propessoas.ufg.br/"
  },
  {
   "key": "prograd",
   "name": "Pró-Reitoria de Graduação",
   "acronym": "PROGRAD",
   "kind": "agency",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://prograd.ufg.br/",
   "notes": "RIG legend misprints 'PROGRAF'; PROGRAD is the usual form."
  },
  {
   "key": "prpi",
   "name": "Pró-Reitoria de Pesquisa e Inovação",
   "acronym": "PRPI",
   "kind": "agency",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://prpi.ufg.br/"
  },
  {
   "key": "prpg",
   "name": "Pró-Reitoria de Pós-Graduação",
   "acronym": "PRPG",
   "kind": "agency",
   "group": "Pró-Reitoria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://prpg.ufg.br/"
  },
  {
   "key": "seacult",
   "name": "Secretaria de Arte e Cultura",
   "acronym": "SEACULT",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "",
   "officialUrl": "https://seacult.ufg.br/",
   "notes": "New in 2026; took over the culture side of the former PROEC. Structure includes Diretoria de Patrimônio, Memória e Museus; Diretoria de Produção e Difusão Artística e Cultural; Centro Cultural UFG; Museu Antropológico; Museu de Ciências; Projeto Memórias UFG."
  },
  {
   "key": "secom",
   "name": "Secretaria de Comunicação",
   "acronym": "SECOM",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://secom.ufg.br/",
   "notes": "Rádio Universitária is under SECOM (Portaria 3115/2026)."
  },
  {
   "key": "sin",
   "name": "Secretaria de Inclusão",
   "acronym": "SIN",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "",
   "officialUrl": "https://sin.ufg.br/"
  },
  {
   "key": "seinfra",
   "name": "Secretaria de Infraestrutura",
   "acronym": "SEINFRA",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://seinfra.ufg.br/"
  },
  {
   "key": "secplan",
   "name": "Secretaria de Planejamento, Avaliação e Informações Institucionais",
   "acronym": "SECPLAN",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://secplan.ufg.br/"
  },
  {
   "key": "sdh",
   "name": "Secretaria de Promoção da Segurança e Direitos Humanos",
   "acronym": "SDH",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "Campus Samambaia",
   "officialUrl": "https://sdh.ufg.br/"
  },
  {
   "key": "sri",
   "name": "Secretaria de Relações Internacionais",
   "acronym": "SRI",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "",
   "officialUrl": "https://sri.ufg.br/",
   "notes": "Includes Instituto Confúcio de Medicina Chinesa (Portaria 3115/2026)."
  },
  {
   "key": "seti",
   "name": "Secretaria de Tecnologia e Informação",
   "acronym": "SETI",
   "kind": "agency",
   "group": "Secretaria",
   "campus": "",
   "officialUrl": "https://seti.ufg.br/"
  },
  {
   "key": "centro-de-educacao-tecnico-e-tecnologico",
   "name": "Centro de Educação Técnico e Tecnológico",
   "acronym": "",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "",
   "officialUrl": "",
   "uncertain": true,
   "notes": "Listed in Portaria 3115/2026 under Reitoria; no website or acronym found."
  },
  {
   "key": "cefis",
   "name": "Centro de Formação Interprofissional em Saúde",
   "acronym": "CEFIS",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Firminópolis",
   "officialUrl": "https://firminopolis.ufg.br/",
   "notes": "Written 'Cefis' on ufg.br. RIG 2025 also mentions the Centro Regional de Desenvolvimento da Educação e do Trabalho Interprofissional em Saúde (CReDETIS/UFG) in Firminópolis."
  },
  {
   "key": "ceagrif",
   "name": "Centro de Formação, Capacitação e Desenvolvimento de Tecnologias para a Agricultura Familiar",
   "acronym": "Ceagrif",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Caldas Novas",
   "officialUrl": "",
   "notes": "Inaugurated Dec/2025 in Caldas Novas; acronym as written on ufg.br."
  },
  {
   "key": "cidarq",
   "name": "Centro de Informação, Documentação e Arquivo",
   "acronym": "CIDARQ",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Campus Samambaia",
   "officialUrl": "https://cidarq.ufg.br/",
   "notes": "ufg.br units page words it 'Centro de Informações Documentação e Memória'; Portaria 3115/2026 says 'Centro de Informação, Documentação e Arquivo'."
  },
  {
   "key": "cercomp",
   "name": "Centro de Recursos Computacionais",
   "acronym": "CERCOMP",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Campus Samambaia",
   "officialUrl": "https://cercomp.ufg.br/",
   "uncertain": true
  },
  {
   "key": "cerof",
   "name": "Centro de Referência em Oftalmologia",
   "acronym": "CEROF",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "",
   "officialUrl": "",
   "uncertain": true,
   "notes": "Listed in Portaria 3115/2026 under Reitoria; acronym CEROF is customary but not printed in the sources read."
  },
  {
   "key": "cegraf",
   "name": "Centro Editorial e Gráfico",
   "acronym": "CEGRAF",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Campus Samambaia",
   "officialUrl": "https://cegraf.ufg.br/",
   "uncertain": true
  },
  {
   "key": "ciar",
   "name": "Centro Integrado de Aprendizagem em Rede",
   "acronym": "CIAR",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "",
   "officialUrl": "https://www.ciar.ufg.br/",
   "notes": "UFG's distance-learning center."
  },
  {
   "key": "editora-ufg",
   "name": "Editora UFG",
   "acronym": "",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "",
   "officialUrl": "https://editora.ufg.br/",
   "uncertain": true,
   "notes": "Appears as 'Coordenação da Editora UFG' in Portaria 3115/2026; parent unclear from the table."
  },
  {
   "key": "instituto-verbena",
   "name": "Instituto Verbena",
   "acronym": "",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://institutoverbena.ufg.br/",
   "notes": "Selection/exams center ('Centro de Seleção/Verbena' in Colemar annex). Linked to Reitoria in Portaria 3115/2026."
  },
  {
   "key": "ptss",
   "name": "Polo de Tecnologias Sociais e Sustentabilidade",
   "acronym": "PTSS",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "",
   "officialUrl": "",
   "notes": "'Diretoria do Polo de Tecnologias Sociais e Sustentabilidade' / 'Coordenação Administrativa do PTSS' in Portaria 3115/2026."
  },
  {
   "key": "sibi",
   "name": "Sistema de Bibliotecas",
   "acronym": "SIBi",
   "kind": "agency",
   "group": "Órgão Suplementar",
   "campus": "Campus Samambaia",
   "officialUrl": "https://bc.ufg.br/",
   "uncertain": true,
   "notes": "Acronym written 'Sibi' on ufg.br. Biblioteca Central at Samambaia, Biblioteca Seccional Colemar Natal e Silva, Biblioteca Seccional Câmpus Goiás (Cajuí). Parent in the 2026 SIORG table is ambiguous."
  },
  {
   "key": "ccufg",
   "name": "Centro Cultural UFG",
   "acronym": "CCUFG",
   "kind": "agency",
   "group": "Museu/Centro Cultural",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://centrocultural.ufg.br/",
   "uncertain": true,
   "notes": "Theatre, Galeria de Vidro, Sala de Dança. Campus assumed from its Setor Universitário location; verify."
  },
  {
   "key": "centro-de-cultura-e-eventos",
   "name": "Centro de Cultura e Eventos",
   "acronym": "",
   "kind": "agency",
   "group": "Museu/Centro Cultural",
   "campus": "Campus Samambaia",
   "officialUrl": "https://centrodeeventos.ufg.br/"
  },
  {
   "key": "ma",
   "name": "Museu Antropológico",
   "acronym": "MA",
   "kind": "agency",
   "group": "Museu/Centro Cultural",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://museu.ufg.br/",
   "notes": "'MA' used in Portaria ('Coordenação Administrativa MA')."
  },
  {
   "key": "museu-de-ciencias",
   "name": "Museu de Ciências",
   "acronym": "",
   "kind": "agency",
   "group": "Museu/Centro Cultural",
   "campus": "",
   "officialUrl": "https://mc.ufg.br/",
   "notes": "Created by Resolução CONSUNI 23/2016 as a network of museum nuclei (Museu de Ciências Morfológicas, Museu de Informática e Computação, Museu de Geociências, Museu de Solos, Pátio da Ciência, Ateliê Tipográfico, Planetário)."
  },
  {
   "key": "planetario-ufg",
   "name": "Planetário UFG",
   "acronym": "",
   "kind": "agency",
   "group": "Museu/Centro Cultural",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://planetario.ufg.br/"
  },
  {
   "key": "hc-ufg",
   "name": "Hospital das Clínicas da UFG (Ebserh)",
   "acronym": "HC-UFG",
   "kind": "agency",
   "group": "Hospital",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://www.gov.br/ebserh/pt-br/hospitais-universitarios/regiao-centro-oeste/hc-ufg",
   "notes": "Managed by Ebserh; staff may be Ebserh employees rather than UFG servidores (relevant because CONSUNI 39/2020 requires the coordinator to be an active UFG servidor)."
  },
  {
   "key": "hospital-veterinario",
   "name": "Hospital Veterinário",
   "acronym": "",
   "kind": "agency",
   "group": "Hospital",
   "campus": "Campus Samambaia",
   "officialUrl": "https://hospitalveterinario.evz.ufg.br/"
  },
  {
   "key": "radio-universitaria",
   "name": "Rádio Universitária",
   "acronym": "",
   "kind": "agency",
   "group": "Comunicação",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "https://radio.ufg.br/"
  },
  {
   "key": "tv-ufg",
   "name": "TV UFG",
   "acronym": "",
   "kind": "agency",
   "group": "Comunicação",
   "campus": "",
   "officialUrl": "https://www.tvufg.org.br/",
   "uncertain": true,
   "notes": "Listed on goias.ufg.br as linked to UFG; not present in Portaria 3115/2026 (possibly run via a foundation). Verify before treating as a UFG unit."
  },
  {
   "key": "campus-caldas-novas",
   "name": "Câmpus Caldas Novas",
   "acronym": "",
   "kind": "agency",
   "group": "Câmpus",
   "campus": "Caldas Novas",
   "officialUrl": "",
   "notes": "Created by Resolução CONSUNI 24/2020; hosts Ceagrif."
  },
  {
   "key": "campus-cidade-ocidental",
   "name": "Câmpus Cidade Ocidental",
   "acronym": "",
   "kind": "agency",
   "group": "Câmpus",
   "campus": "Cidade Ocidental",
   "officialUrl": "https://co.ufg.br/",
   "notes": "Academic activities started 2nd semester 2025; houses IIG."
  },
  {
   "key": "campus-firminopolis",
   "name": "Câmpus Firminópolis",
   "acronym": "",
   "kind": "agency",
   "group": "Câmpus",
   "campus": "Firminópolis",
   "officialUrl": "https://firminopolis.ufg.br/",
   "notes": "Hosts CEFIS."
  },
  {
   "key": "direcao-do-campus-goias",
   "name": "Direção do Câmpus Goiás",
   "acronym": "",
   "kind": "agency",
   "group": "Câmpus",
   "campus": "Cidade de Goiás",
   "officialUrl": "https://goias.ufg.br/",
   "notes": "Has a 'Coordenação de Extensão e Cultura do Câmpus Goiás' (IN PROEC 01/2020 art. 6-7; Portaria 3115/2026) that supervises CAEX of UAECH/UAECSA and chairs the câmpus Câmara de Extensão e Cultura."
  },
  {
   "key": "casa-projetos-sociais",
   "name": "Casa Projetos Sociais",
   "acronym": "",
   "kind": "agency",
   "group": "Outro",
   "campus": "",
   "officialUrl": "https://proex.ufg.br/p/29435-casa-projetos-sociais"
  },
  {
   "key": "centro-de-linguas",
   "name": "Centro de Línguas",
   "acronym": "",
   "kind": "agency",
   "group": "Outro",
   "campus": "Campus Samambaia",
   "officialUrl": "https://cl.letras.ufg.br/",
   "uncertain": true,
   "notes": "Sub-unit; in SIGAA the 'unidade proponente' is the coordinator's lotação, so its actions likely appear under FL."
  },
  {
   "key": "gabinete-da-reitoria",
   "name": "Gabinete da Reitoria",
   "acronym": "",
   "kind": "agency",
   "group": "Outro",
   "campus": "Campus Samambaia",
   "officialUrl": "https://ufg.br/",
   "uncertain": true,
   "notes": "Included because CEPEC 1699/2021 allows 'órgãos da UFG' to propose actions; unclear if it registers actions in practice."
  },
  {
   "key": "nucleo-de-pratica-juridica",
   "name": "Núcleo de Prática Jurídica",
   "acronym": "",
   "kind": "agency",
   "group": "Outro",
   "campus": "Campus Colemar Natal e Silva",
   "officialUrl": "",
   "uncertain": true,
   "notes": "Sub-unit (also exists in UAECSA, Câmpus Goiás)."
  }
 ]
};
export default data;

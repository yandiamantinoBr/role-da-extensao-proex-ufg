export const NODE_KINDS = ['council','office','directorate','coordination','publication','unit'] as const;
export const RELATIONS = ['root','subordination','governance'] as const;
export type NodeKind = typeof NODE_KINDS[number];
export type Relation = typeof RELATIONS[number];
export const kindLabels: Record<NodeKind,string> = {council:'Colegiado',office:'Pró-reitoria',directorate:'Diretoria',coordination:'Coordenação',publication:'Publicação',unit:'Outra unidade formal'};
export const relationLabels: Record<Relation,string> = {root:'Raiz',subordination:'Subordinação',governance:'Governança'};
export type StructureNode = {id:string;parentId:string|null;name:string;acronym:string;kind:NodeKind;relation:Relation;position:number;status:'active'|'archived'};
export type StructureSource = {label:string;revision:string;issuedOn:string|null;referenceUrl:string|null;adapted:boolean};
export type StructureWorkspace = {viewerId:string;scope:{organizationId:string;organizationName:string;projectId:string|null;projectName:string;canManage:boolean};version:number;source:StructureSource|null;nodes:StructureNode[];teams:{id:string;name:string;status:'active'|'archived'}[];links:{nodeId:string;teamId:string}[];asOf:string};
export const OFFICIAL_SOURCE = {label:'Organograma PROEX UFG',revision:'5.0.3',issuedOn:'2026-07-28',referenceUrl:'https://files.cercomp.ufg.br/weby/up/694/o/Estrutura_Organizacional_-_2026.pdf',sha256:'db862c20ab4b9d5328651e129d4a2ffe5dbfa371715293f1a2fac2293d48dc91'} as const;
export type TemplateNode = {key:string;parentKey:string|null;name:string;acronym:string;kind:NodeKind;relation:Relation;position:number};
/** Public reference only. Applying it never assigns people, teams or permissions. */
export const OFFICIAL_TEMPLATE:TemplateNode[] = [
 {key:'cec',parentKey:null,name:'Câmara de Extensão e Cultura',acronym:'CEC',kind:'council',relation:'root',position:0},
 {key:'proex',parentKey:'cec',name:'Pró-reitoria de Extensão',acronym:'PROEX',kind:'office',relation:'governance',position:0},
 {key:'extension',parentKey:'proex',name:'Diretoria de Extensão',acronym:'',kind:'directorate',relation:'subordination',position:0},
 {key:'actions',parentKey:'extension',name:'Coordenação de Ações de Extensão',acronym:'',kind:'coordination',relation:'subordination',position:0},
 {key:'house',parentKey:'extension',name:'Coordenação Casa Projetos Sociais',acronym:'',kind:'coordination',relation:'subordination',position:1},
 {key:'logistics',parentKey:'proex',name:'Diretoria de Articulação e Logística',acronym:'',kind:'directorate',relation:'subordination',position:1},
 {key:'notices',parentKey:'logistics',name:'Coordenação de Acompanhamento de Editais',acronym:'',kind:'coordination',relation:'subordination',position:0},
 {key:'events',parentKey:'logistics',name:'Coordenação de Eventos Institucionais',acronym:'',kind:'coordination',relation:'subordination',position:1},
 {key:'culture',parentKey:'logistics',name:'Coordenação Centro de Cultura e Eventos',acronym:'',kind:'coordination',relation:'subordination',position:2},
 {key:'administration',parentKey:'proex',name:'Coordenação Administrativa',acronym:'',kind:'coordination',relation:'subordination',position:2},
 {key:'journal',parentKey:'proex',name:'Revista UFG',acronym:'',kind:'publication',relation:'subordination',position:3},
];

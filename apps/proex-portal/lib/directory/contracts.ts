export const DIRECTORY_STATES=['pending','review','archived'] as const;
export type DirectoryStatus=typeof DIRECTORY_STATES[number];
export const directoryLabels:Record<DirectoryStatus,string>={pending:'Pré-cadastrado',review:'Conferir dados',archived:'Arquivado'};
export type DirectoryPerson={id:string;name:string;position:string;sector:string;contact:string;contactStatus:'published'|'entered'|'review';status:DirectoryStatus;version:number;sourceKind:'manual'|'official';referenceId:string|null;sourceUrl:string|null;sourceUpdatedOn:string|null;checkedOn:string;adapted:boolean;createdAt:string;updatedAt:string};
export type DirectoryHistory={version:number;at:string;person:DirectoryPerson};
export type DirectoryWorkspace={viewerId:string;scope:{organizationId:string;organizationName:string};people:DirectoryPerson[];asOf:string};
export type DirectoryDetail={viewerId:string;organizationId:string;person:DirectoryPerson;history:DirectoryHistory[];historyHasMore:boolean};

import type { TaskPriority, TaskStatus } from './contracts';
export const TEAM_TASK_PAGE_SIZE = 6;

export type TeamPerson = { userId: string; name: string };
export type TeamCounts = Record<TaskStatus, number> & { total: number; high: number; overdue: number };
export type TeamProject = {
 id: string;
 name: string;
 stage: 'active' | 'past' | 'catalog' | 'archived';
 hasDemands: boolean;
 hasResponsibilities: boolean;
};
export type TeamUnit = { id: string; name: string; acronym: string };
export type WorkTeam = {
 id: string; name: string; status: 'active' | 'archived'; version: number; isMine: boolean;
 members: TeamPerson[]; counts: TeamCounts;
 projects: TeamProject[]; units: TeamUnit[];
};
export type TeamTask = {
 id: string; title: string; status: TaskStatus; priority: TaskPriority; due_at: string | null;
 project_id: string | null; project_name: string; organization_name: string;
 assignees: { user_id: null; team_id: string; name: string }[];
};
export type TeamsWorkspace = {
 viewerId: string; scope: { organizationId: string; organizationName: string; projectId: string | null; projectName: string; canManage: boolean };
 teams: WorkTeam[]; people: TeamPerson[]; teamsTruncated: boolean;
 selectedTeamId: string; tasks: TeamTask[]; hasMore: boolean; nextOffset: number | null;
 today: string; asOf: string;
};

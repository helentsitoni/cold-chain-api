import { Role, SampleStatus } from '@prisma/client';

type Rule = { from: SampleStatus; to: SampleStatus; roles: Role[] };

export const TRANSITIONS: Rule[] = [
  { from: 'COLLECTED', to: 'IN_TRANSIT', roles: ['FIELD_NURSE'] },
  { from: 'IN_TRANSIT', to: 'LAB_RECEIVED', roles: ['LAB_ANALYST'] },
  { from: 'LAB_RECEIVED', to: 'ANALYSIS_COMPLETE', roles: ['LAB_ANALYST'] },
  { from: 'ANALYSIS_COMPLETE', to: 'STORED', roles: ['LAB_ANALYST'] },
];
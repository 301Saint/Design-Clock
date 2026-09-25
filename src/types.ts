export type JobStatus = 'active' | 'on_hold' | 'completed' | 'archived';

export const STATUS_LABEL: Record<JobStatus, string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

export type Rounding = 'exact' | 'nearest15' | 'nearest30' | 'up15' | 'up30';

export const ROUNDING_LABEL: Record<Rounding, string> = {
  exact: 'Exact',
  nearest15: 'Nearest 15 minutes',
  nearest30: 'Nearest 30 minutes',
  up15: 'Round up to next 15 minutes',
  up30: 'Round up to next 30 minutes',
};

export interface Job {
  id: number;
  job_number: string;
  client_id: number;
  client: string;
  project_name: string;
  notes: string;
  status: JobStatus;
  created_at: number;
  updated_at: number;
  total_sec: number;
  session_count: number;
  last_worked_at: number | null;
}

export interface Session {
  id: number;
  job_id: number;
  category_id: number | null;
  category: string | null;
  start_at: number;
  end_at: number | null;
  idle_sec: number;
  duration_sec: number | null;
  notes: string;
  source: 'timer' | 'manual' | 'manual_duration';
  job_number: string;
  project_name: string;
  job_status: JobStatus;
  client_id: number;
  client: string;
  created_at: number;
  updated_at: number;
}

export interface Category {
  id: number;
  name: string;
  sort_order: number;
  archived: number;
  session_count?: number;
}

export interface Settings {
  hourlyRate: number;
  currency: string;
  rounding: Rounding;
  theme: 'dark' | 'light' | 'system';
  idleDetection: boolean;
  idleThresholdMin: number;
  confirmSwitch: boolean;
}

export interface IdleInfo {
  seconds: number;
  startAt: number;
  endAt: number | null;
}

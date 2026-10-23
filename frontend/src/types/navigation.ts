export type SectionId =
  | 'live-operations'
  | 'camera-detection'
  | 'scenario-lab'
  | 'emergency-routing'
  | 'incidents-reports';

export interface NavItem {
  id: SectionId;
  label: string;
  shortcutKey: string;
  badge?: string;
  badgeType?: 'critical' | 'warning' | 'info' | 'neutral';
  isImplementedInMilestone1: boolean;
}

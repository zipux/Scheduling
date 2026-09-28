import type { ScheduleWarning } from "@/lib/schedule-warnings";

export interface BoardShift {
  id: string;
  membershipId: string | null;
  date: string;
  start: string;
  end: string;
  breakMinutes: number;
  locationId: string;
  locationName: string;
  positionId: string | null;
  positionName: string | null;
  color: string;
  status: "draft" | "published";
  notes: string;
  past: boolean;
  warnings: ScheduleWarning[];
  geofenceOverride: { mode: "off" } | { mode: "custom"; lat: number; lng: number; radiusM: number } | null;
}

export interface BoardMember {
  id: string;
  name: string;
  positionIds: string[];
  locationIds: string[];
}

export interface BoardData {
  businessId: string;
  weekStart: string;
  prevWeek: string;
  nextWeek: string;
  thisWeek: string;
  days: string[];
  today: string;
  shifts: BoardShift[];
  members: BoardMember[];
  positions: { id: string; name: string; color: string }[];
  locations: { id: string; name: string; timezone: string }[];
  scope: { options: { id: string; name: string }[]; selected: string | null; showSwitcher: boolean };
  templates: { id: string; name: string; start: string; end: string; breakMinutes: number; locationId: string | null; positionId: string | null }[];
  holidays: { date: string; name: string; isStatutory: boolean }[];
  canEdit: boolean;
  canPublish: boolean;
  wages: null | {
    currency: string;
    byDay: Record<string, number>;
    week: number;
    burdenPercent: number | null;
    burdenNote: string | null;
    missingWage: number;
  };
  draftCount: number;
}

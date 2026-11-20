export type WorkingStatus = 'available' | 'busy' | 'on_leave';
export type WorkingStatusDotTone = 'emerald' | 'amber' | 'rose';

export function getWorkingStatusLabel(status: WorkingStatus): string {
  switch (status) {
    case 'busy':
      return 'On Visit';
    case 'on_leave':
      return 'Inactive';
    default:
      return 'Available';
  }
}

export function getWorkingStatusDotTone(status: WorkingStatus): WorkingStatusDotTone {
  switch (status) {
    case 'busy':
      return 'amber';
    case 'on_leave':
      return 'rose';
    default:
      return 'emerald';
  }
}

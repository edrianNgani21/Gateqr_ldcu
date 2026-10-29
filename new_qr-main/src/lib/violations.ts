// Shared between the violation API and the Record Violation modal.

export type ViolationLevel = 'first_warning' | 'second_warning' | 'gate_block';

export const VIOLATION_LEVEL_LABELS: Record<ViolationLevel, string> = {
    first_warning: '1st Warning',
    second_warning: '2nd Warning',
    gate_block: 'Gate Block'
};

/**
 * The level of the next violation for a registration, from how many are already recorded.
 * The count never resets: after two warnings, every new violation is a gate block.
 */
export function nextViolationLevel(existingCount: number): ViolationLevel {
    if (existingCount <= 0) return 'first_warning';
    if (existingCount === 1) return 'second_warning';
    return 'gate_block';
}

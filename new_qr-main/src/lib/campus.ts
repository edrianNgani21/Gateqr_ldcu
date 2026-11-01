// Campus is stored once, as campus_gate ('main' | 'rnp' | 'paseo'); screens show the label.
export type CampusGate = 'main' | 'rnp' | 'paseo';

/** Any campus text ('Liceo Main', 'Main Campus', 'RNP', 'paseo', ...) to its campus_gate value. */
export function campusGate(value: string | null | undefined): CampusGate {
    const v = String(value || '').toLowerCase();
    if (v.includes('rnp')) return 'rnp';
    if (v.includes('paseo')) return 'paseo';
    return 'main';
}

/** campus_gate value to the name shown on screen. */
export function campusLabel(gate: string | null | undefined): string {
    const g = campusGate(gate);
    if (g === 'rnp') return 'RNP';
    if (g === 'paseo') return 'PASEO';
    return 'Main Campus';
}

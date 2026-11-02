// One column holds a different document depending on the applicant's role:
//   school_id_file        Student ID (student) or Employee ID (everyone else)
//   enrollment_form_file  Enrollment Form (student) or Load Sheet (faculty); not asked of other roles

function normalize(role: string | null | undefined): string {
    return (role || '').toLowerCase().trim();
}

export function idDocumentLabel(role: string | null | undefined): string {
    return normalize(role) === 'student' ? 'Student ID' : 'Employee ID';
}

/** Whether this role is asked for the second institutional document. */
export function needsLoadDocument(role: string | null | undefined): boolean {
    return ['student', 'faculty'].includes(normalize(role));
}

export function loadDocumentLabel(role: string | null | undefined): string {
    return normalize(role) === 'student' ? 'Enrollment Form' : 'Load Sheet';
}

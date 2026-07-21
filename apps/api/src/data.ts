export type Finding = { id: string; source: 'ai'|'deterministic_rule'|'reviewer'; severity: 'info'|'warning'|'critical'; title: string; detail: string; resolved: boolean };
export type AuditEvent = { id: string; at: string; actor: string; event: string; detail: string };
export type Application = {
  id: string; referenceNo: string; applicantName: string; parcelNo: string; developmentType: string; region: string;
  status: 'draft'|'submitted'|'ai_prescreened'|'under_review'|'needs_revision'|'approved'|'rejected';
  assignedOfficer: string; score: number; findings: Finding[]; documents: { name: string; meta: string }[]; audit: AuditEvent[];
};

export const applications: Application[] = [
  {
    id: 'app-0148', referenceNo: 'APP-2026-0148', applicantName: 'North Valley Estates', parcelNo: 'ZN-4412',
    developmentType: 'Residential Subdivision', region: 'Region II', status: 'under_review', assignedOfficer: 'Maria Santos', score: 78,
    documents: [
      { name: 'Subdivision Development Plan.pdf', meta: '4.8 MB · Version 2' },
      { name: 'Environmental Clearance.pdf', meta: '1.2 MB · Version 1' },
      { name: 'Proof of Land Ownership.pdf', meta: '860 KB · Version 1' },
    ],
    findings: [
      { id: 'f1', source: 'deterministic_rule', severity: 'critical', title: 'Road width below policy minimum', detail: 'Submitted plan shows 7.0 m. Policy ZN-R2-014 requires at least 8.0 m.', resolved: false },
      { id: 'f2', source: 'ai', severity: 'warning', title: 'Drainage plan may be incomplete', detail: 'The uploaded plan references runoff controls but no calculation sheet was detected.', resolved: false },
      { id: 'f3', source: 'ai', severity: 'warning', title: 'Ownership document name mismatch', detail: 'Applicant organization and title-holder names require reviewer verification.', resolved: false },
    ],
    audit: [
      { id: 'a1', at: '2026-07-18 09:14', actor: 'System', event: 'Application submitted', detail: 'Submission version 2 received.' },
      { id: 'a2', at: '2026-07-18 09:16', actor: 'AI Pre-Screening', event: 'Analysis completed', detail: 'Three review findings generated.' },
      { id: 'a3', at: '2026-07-18 10:03', actor: 'Maria Santos', event: 'Review started', detail: 'Application assigned and opened.' },
    ],
  },
  {
    id: 'app-0147', referenceNo: 'APP-2026-0147', applicantName: 'Greenfield Farms', parcelNo: 'AG-2281', developmentType: 'Agricultural Facility', region: 'Region IV', status: 'ai_prescreened', assignedOfficer: 'Daniel Cruz', score: 96, documents: [], findings: [], audit: [],
  },
  {
    id: 'app-0146', referenceNo: 'APP-2026-0146', applicantName: 'Harbor Link Dev Corp', parcelNo: 'MX-7822', developmentType: 'Mixed-use Development', region: 'Capital District', status: 'needs_revision', assignedOfficer: 'Ana Reyes', score: 51, documents: [], findings: [{ id:'f4', source:'deterministic_rule', severity:'critical', title:'Setback conflict', detail:'Eastern boundary conflicts with mixed-use setback rule.', resolved:false }], audit: [],
  },
  {
    id: 'app-0145', referenceNo: 'APP-2026-0145', applicantName: 'Metro Housing Co.', parcelNo: 'UR-6630', developmentType: 'Multi-family Housing', region: 'Region I', status: 'under_review', assignedOfficer: 'Ramon Lee', score: 87, documents: [], findings: [{ id:'f5', source:'ai', severity:'warning', title:'Parking schedule requires confirmation', detail:'One table is low-confidence due to scan quality.', resolved:false }], audit: [],
  }
];

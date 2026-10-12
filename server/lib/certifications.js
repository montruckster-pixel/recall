/**
 * Certification catalog. Stored in the database (not hard-coded into the UI) so
 * new certifications and categories can be added without rebuilding the app.
 */
import { run, all } from './db.js';

export const CERTIFICATIONS = [
  // IT & Cybersecurity
  { slug: 'comptia-a-plus', name: 'CompTIA A+', category: 'IT & Cybersecurity', description: 'IT support fundamentals, hardware, networking and troubleshooting.' },
  { slug: 'comptia-network-plus', name: 'CompTIA Network+', category: 'IT & Cybersecurity', description: 'Network architecture, operations, security and troubleshooting.' },
  { slug: 'comptia-security-plus', name: 'CompTIA Security+', category: 'IT & Cybersecurity', description: 'Core security concepts, threats, architecture and operations.' },
  { slug: 'comptia-cysa-plus', name: 'CompTIA CySA+', category: 'IT & Cybersecurity', description: 'Security analytics, threat detection and incident response.' },
  { slug: 'cissp', name: 'CISSP', category: 'IT & Cybersecurity', description: 'Information security leadership and architecture.' },
  { slug: 'ccna', name: 'Cisco CCNA', category: 'IT & Cybersecurity', description: 'Routing, switching, network fundamentals and automation.' },
  { slug: 'aws-saa', name: 'AWS Solutions Architect Associate', category: 'IT & Cybersecurity', description: 'Designing resilient, secure AWS architectures.' },
  { slug: 'az-104', name: 'Microsoft Azure Administrator (AZ-104)', category: 'IT & Cybersecurity', description: 'Azure identity, storage, compute, networking and monitoring.' },
  { slug: 'linux-plus', name: 'CompTIA Linux+', category: 'IT & Cybersecurity', description: 'Linux system administration and operations.' },
  { slug: 'itil-foundation', name: 'ITIL 4 Foundation', category: 'IT & Cybersecurity', description: 'IT service management practices and principles.' },

  // Healthcare
  { slug: 'nclex-rn', name: 'NCLEX-RN', category: 'Healthcare', description: 'Registered nurse licensure exam content.' },
  { slug: 'cna', name: 'Certified Nursing Assistant (CNA)', category: 'Healthcare', description: 'Nursing assistant skills and patient care.' },
  { slug: 'emt-basic', name: 'EMT Basic', category: 'Healthcare', description: 'Emergency medical technician fundamentals.' },
  { slug: 'cpc-medical-coding', name: 'CPC Medical Coding', category: 'Healthcare', description: 'Medical coding, terminology and reimbursement.' },
  { slug: 'pharmacy-tech', name: 'Pharmacy Technician (PTCB)', category: 'Healthcare', description: 'Medication handling, pharmacy law and patient safety.' },
  { slug: 'bls-acls', name: 'BLS / ACLS', category: 'Healthcare', description: 'Basic and advanced life support.' },

  // Trades & Technical
  { slug: 'electrician-journeyman', name: 'Journeyman Electrician', category: 'Trades & Technical', description: 'Electrical theory, code and installation practice.' },
  { slug: 'hvac-epa608', name: 'EPA Section 608 (HVAC)', category: 'Trades & Technical', description: 'Refrigerant handling and environmental compliance.' },
  { slug: 'welding-cert', name: 'Welding Certification', category: 'Trades & Technical', description: 'Welding processes, safety and inspection.' },
  { slug: 'osha-30', name: 'OSHA 30', category: 'Trades & Technical', description: 'Workplace safety and hazard standards.' },
  { slug: 'cdl', name: 'Commercial Driver\'s License (CDL)', category: 'Trades & Technical', description: 'Commercial driving rules, safety and inspection.' },

  // Business & Finance
  { slug: 'pmp', name: 'PMP', category: 'Business & Finance', description: 'Project management processes, people and business environment.' },
  { slug: 'cfa-level-1', name: 'CFA Level I', category: 'Business & Finance', description: 'Investment foundations, ethics, and quantitative methods.' },
  { slug: 'cpa-far', name: 'CPA — FAR', category: 'Business & Finance', description: 'Financial accounting and reporting.' },
  { slug: 'six-sigma-green', name: 'Six Sigma Green Belt', category: 'Business & Finance', description: 'Process improvement and statistical quality methods.' },
  { slug: 'shrm-cp', name: 'SHRM-CP', category: 'Business & Finance', description: 'HR competencies and behavioral practices.' },

  // Other
  { slug: 'real-estate', name: 'Real Estate License', category: 'Other', description: 'Property law, finance, agency and practice.' },
  { slug: 'series-7', name: 'FINRA Series 7', category: 'Other', description: 'General securities representative content.' },
  { slug: 'teas', name: 'TEAS (Nursing School)', category: 'Other', description: 'Reading, math, science and English for nursing programs.' },
  { slug: 'gre', name: 'GRE', category: 'Other', description: 'Graduate record examination verbal, quant and writing.' },
  { slug: 'custom', name: 'Other / Custom certification', category: 'Other', description: 'Preparing for something else — name it during onboarding.' },
];

export function ensureCertifications() {
  const ts = 100;
  for (const [i, c] of CERTIFICATIONS.entries()) {
    run(
      `INSERT INTO certifications (slug, name, category, description, sort_order, active)
       VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(slug) DO UPDATE SET name=excluded.name, category=excluded.category, description=excluded.description`,
      [c.slug, c.name, c.category, c.description, i + 1],
    );
  }
  void ts;
}

export function listCertifications() {
  const rows = all('SELECT * FROM certifications WHERE active = 1 ORDER BY sort_order, name');
  const categories = {};
  for (const r of rows) {
    categories[r.category] = categories[r.category] || [];
    categories[r.category].push({ slug: r.slug, name: r.name, description: r.description });
  }
  return Object.entries(categories).map(([category, items]) => ({ category, items }));
}

import type { DatabaseSync } from 'node:sqlite';

type Phase = [workdaysAgo: number, category: string, minutes: number, note: string];
type SeedJob = {
  num: string; client: string; project: string;
  status: 'active' | 'on_hold' | 'completed' | 'archived';
  notes: string; phases: Phase[];
};

const JOBS: SeedJob[] = [
  {
    num: '2861', client: 'Lakeside Marina', project: 'Dock Wayfinding Signs', status: 'archived',
    notes: 'Aluminum composite, 12 signs.',
    phases: [
      [24, 'Research', 25, 'Reviewed marina map + ADA requirements'],
      [24, 'Initial Design', 95, 'Sign family layout, arrows + numbering system'],
      [23, 'Client Revisions', 40, 'Swapped navy for brand teal'],
      [22, 'Production Setup', 55, 'Tiled for router, added bleed'],
    ],
  },
  {
    num: '2875', client: 'Summit Realty', project: 'Yard Sign Refresh', status: 'completed',
    notes: '18x24 coroplast, double-sided.',
    phases: [
      [20, 'Initial Design', 70, 'Two layouts using new agent headshots'],
      [19, 'Client Revisions', 25, 'Larger phone number'],
      [19, 'Preflight', 15, ''],
      [18, 'Production Setup', 30, 'Ganged 4-up on 48x96'],
    ],
  },
  {
    num: '2889', client: 'Peak Fitness', project: 'Storefront Window Graphics', status: 'completed',
    notes: 'Perforated vinyl + cut lettering.',
    phases: [
      [17, 'Photo Mockup', 45, 'Mocked on storefront photo from site survey'],
      [17, 'Initial Design', 80, 'Full-window perf layout'],
      [16, 'Design Concepts', 50, 'Alt concept with athlete photo'],
      [14, 'Client Revisions', 35, 'Hours of operation update'],
      [13, 'Internal Revisions', 20, 'Adjusted for door hardware'],
      [12, 'Production Setup', 60, 'Paneled perf, weeded lettering file'],
    ],
  },
  {
    num: '2902', client: 'Harbor Brewing Co.', project: 'Logo Recreation & Tap Handle Decals', status: 'completed',
    notes: 'Client only had a low-res JPG.',
    phases: [
      [13, 'Logo Recreation', 110, 'Rebuilt anchor mark + custom type in vector'],
      [12, 'Vector Cleanup', 40, 'Smoothed curves, merged overlapping paths'],
      [11, 'Initial Design', 55, 'Tap handle decal sheet, 8 beers'],
      [10, 'Client Revisions', 30, 'Changed IPA color'],
      [9, 'File Preparation', 25, 'Print & cut marks'],
    ],
  },
  {
    num: '2933', client: 'Riverside Community Church', project: 'Event Banner Set', status: 'on_hold',
    notes: 'Waiting on event dates from client.',
    phases: [
      [8, 'Initial Design', 65, '3x8 banner template'],
      [7, 'Design Concepts', 40, 'Seasonal color variations'],
    ],
  },
  {
    num: '2928', client: 'Coastal HVAC', project: 'Fleet Vehicle Graphics', status: 'active',
    notes: '6 vans + 2 pickups. Match existing fleet.',
    phases: [
      [7, 'Research', 30, 'Pulled vehicle templates for Promaster + F-150'],
      [6, 'Initial Design', 90, 'Van side layout with new tagline'],
      [5, 'Mockup', 40, 'Mocked on white Promaster'],
      [3, 'Client Revisions', 35, 'Bigger phone number, removed QR'],
      [1, 'Internal Revisions', 20, 'Adjusted for sliding door seam'],
    ],
  },
  {
    num: '2920', client: 'Smith Landscaping', project: '4x8 Pylon Sign', status: 'active',
    notes: 'Double-sided, internally lit.',
    phases: [
      [5, 'Initial Design', 75, 'Stacked logo layout'],
      [4, 'Photo Mockup', 35, 'Placed on site photo at night'],
      [2, 'Client Revisions', 30, 'Tried green background'],
      [0, 'Revisions', 48, 'Final color tweaks'],
    ],
  },
  {
    num: '2911', client: 'Main Street Dental', project: 'Lobby Wall Mural', status: 'active',
    notes: 'Wall is 14\' x 9\'. Printed wallcovering.',
    phases: [
      [4, 'Research', 20, 'Wall measurements + outlet locations'],
      [3, 'Design Concepts', 85, 'Three mural concepts: coastal, abstract, botanical'],
      [2, 'Photo Mockup', 45, 'Concepts mocked in lobby photo'],
      [1, 'Client Revisions', 40, 'Client picked coastal, lighten blues'],
      [0, 'Revisions', 52, 'Reworked wave pattern'],
      [0, 'Photo Mockup', 40, 'Updated lobby mockup'],
    ],
  },
  {
    num: '2847', client: 'ABC Plumbing', project: 'Ford Transit Full Wrap', status: 'active',
    notes: 'High-roof 148" WB. Customer supplied logo EPS.',
    phases: [
      [6, 'Research', 20, 'Pulled Transit high-roof template'],
      [5, 'Initial Design', 42, 'Blocked out driver side'],
      [4, 'Initial Design', 60, 'Started passenger side layout'],
      [3, 'Mockup', 35, '3D mockup for client'],
      [2, 'Client Revisions', 45, 'Moved logo forward, added service list'],
      [1, 'Client Revisions', 30, 'Swapped truck photo'],
      [0, 'Production Setup', 55, 'Paneled for 54" media, added bleed'],
      [0, 'Preflight', 25, 'Checked resolution, outlined fonts'],
    ],
  },
];

/** Returns local midnight N workdays (Mon–Fri) before today. */
function workdayBack(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d;
}

export function seed(db: DatabaseSync): number[] {
  const now = Date.now();
  const cats = new Map<string, number>();
  for (const r of db.prepare('SELECT id, name FROM categories').all() as { id: number; name: string }[]) {
    cats.set(r.name, r.id);
  }
  const insClient = db.prepare('INSERT INTO clients (name, created_at) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id');
  const insJob = db.prepare(`INSERT INTO jobs (job_number, client_id, project_name, notes, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`);
  const insSession = db.prepare(`INSERT INTO sessions (job_id, category_id, start_at, end_at, notes, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'timer', ?, ?)`);

  // Past days fill forward from 8:12 AM; today fills backward from ~20 min ago.
  const dayCursor = new Map<number, number>();
  const todayStart = workdayBack(0).getTime();
  let todayCursor = now - 20 * 60_000;
  const todays: { jobId: number; phase: Phase }[] = [];
  const jobIds: number[] = [];

  db.exec('BEGIN');
  try {
    for (const job of JOBS) {
      const firstDay = workdayBack(Math.max(...job.phases.map((p) => p[0]))).getTime();
      const clientId = (insClient.get(job.client, firstDay) as { id: number }).id;
      const created = firstDay + 8 * 3600_000;
      const jobId = (insJob.get(job.num, clientId, job.project, job.notes, job.status, created, created) as { id: number }).id;
      jobIds.push(jobId);
      for (const phase of job.phases) {
        const [ago, cat, min, note] = phase;
        if (ago === 0) { todays.push({ jobId, phase }); continue; }
        const day = workdayBack(ago).getTime();
        const start = dayCursor.get(day) ?? day + (8 * 60 + 12) * 60_000;
        const end = start + min * 60_000;
        insSession.run(jobId, cats.get(cat) ?? null, start, end, note, end, end);
        dayCursor.set(day, end + (7 + ((min * 7) % 23)) * 60_000);
      }
    }
    // Interleave today's sessions (reverse so the list reads naturally).
    for (const { jobId, phase } of todays.reverse()) {
      const [, cat, min, note] = phase;
      const end = todayCursor;
      const start = end - min * 60_000;
      if (start < todayStart + 6 * 3600_000) break; // too early in the day to fake a morning
      insSession.run(jobId, cats.get(cat) ?? null, start, end, note, end, end);
      todayCursor = start - (4 + (min % 9)) * 60_000;
    }
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('sampleJobIds', JSON.stringify(jobIds));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return jobIds;
}

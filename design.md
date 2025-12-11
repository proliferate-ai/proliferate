perfect-here’s a clean, **Two Contexts** spec with **short titles + subtitles** and a **custom React component per tab**. No “list items”-each selection renders its own panel component. Use this as the blueprint your team can code against.

---

# Section wrapper

* **Section title:** **One platform. Two contexts.**
* **Section subtitle:** *Org memory × runtime reality → one fix.*

Layout: two side-by-side cards, each with its own tabbar (pills). Default active tabs: **Owner** (left) and **Issue** (right).

---

## Left card - Institutional (org memory)

* **Card title:** **Org memory**
* **Card subtitle:** *How it should work.*

### Tabs → Panels (each is its own React component)

1. **Owner**

   * **Panel title:** **Ownership**
   * **Panel subtitle:** *People who know this area.*
   * **Graphic (render spec):** owner header row with avatar + name, confidence chip; domain/area chips; “similar fixes” mini-metric.
   * **Component:** `<OwnerPanel />`
   * **Props (TS):**

     ```ts
     type OwnerPanelProps = {
       primary: { name: string; avatarUrl?: string };
       confidence: number;           // 0–100
       areas: string[];              // e.g., ['Checkout','Payments']
       similarFixes: { count: number; windowLabel: string }; // {4,'60d'}
       backups?: { name: string }[];
     };
     ```
   * **Alt text:** `Owner with confidence, areas, and recent similar fixes.`

2. **PRs**

   * **Panel title:** **Recent PRs**
   * **Panel subtitle:** *What changed lately.*
   * **Graphic:** compact vertical PR timeline with id, status, reviewer; diff bar (+/−) for active PR; file-count chip.
   * **Component:** `<PRsPanel />`
   * **Props:**

     ```ts
     type PRsPanelProps = {
       items: { id: string; title: string; status:'merged'|'open';
                mergedAt?: string; reviewer?: string; plus?: number; minus?: number; files?: number }[];
       activeIndex?: number;
     };
     ```
   * **Alt text:** `Recent PRs with merge status and diff size.`

3. **Docs**

   * **Panel title:** **Decisions**
   * **Panel subtitle:** *Docs & RFCs that define behavior.*
   * **Graphic:** doc cards with title/id, status chip (Approved/Accepted), 1–2 bullet decisions; “Open doc” chevron.
   * **Component:** `<DocsPanel />`
   * **Props:**

     ```ts
     type DocsPanelProps = {
       docs: { id: string; title: string; status: 'Approved'|'Accepted'|'Note'; bullets: string[]; url?: string }[];
     };
     ```
   * **Alt text:** `Approved RFCs and decisions for this area.`

4. **Roadmap**

   * **Panel title:** **Roadmap**
   * **Panel subtitle:** *What’s in flight now.*
   * **Graphic:** ticket cards with status badge, progress bar%, ETA chip, 1–2 subtasks.
   * **Component:** `<RoadmapPanel />`
   * **Props:**

     ```ts
     type RoadmapPanelProps = {
       tickets: { id: string; title: string; status:'Planned'|'In progress'|'Queued';
                  progress?: number; eta?: string; subtasks?: { label: string; done: boolean }[] }[];
     };
     ```
   * **Alt text:** `Active tickets with progress and ETA.`

5. **Incidents**

   * **Panel title:** **Incidents**
   * **Panel subtitle:** *History to avoid repeats.*
   * **Graphic:** incident cards with severity, status, RCA chip, action items ✓.
   * **Component:** `<IncidentsPanel />`
   * **Props:**

     ```ts
     type IncidentsPanelProps = {
       incidents: { id: string; title: string; status:'Resolved'|'Closed';
                    severity:'Low'|'Medium'|'High'; rca?: { url: string; ready: boolean };
                    actions?: { label: string; done: boolean; at?: string }[] }[];
     };
     ```
   * **Alt text:** `Recent incidents with RCA and actions.`

---

## Right card - Production (runtime reality)

* **Card title:** **Runtime**
* **Card subtitle:** *What actually happened.*

### Tabs → Panels (each is its own React component)

1. **Issue**

   * **Panel title:** **Sentry issue**
   * **Panel subtitle:** *Grouped by fingerprint.*
   * **Graphic:** issue card with title, severity chip, duplicates chip, 2-line stack preview, affected users chip.
   * **Component:** `<IssuePanel />`
   * **Props:**

     ```ts
     type IssuePanelProps = {
       title: string; severity:'Low'|'Medium'|'High'; duplicates: number;
       stackPreview: string[]; usersAffected?: number;
     };
     ```
   * **Alt text:** `Grouped Sentry issue with severity, duplicates, and stack preview.`

2. **Deploy**

   * **Panel title:** **Deploys**
   * **Panel subtitle:** *Most likely change.*
   * **Graphic:** env pills (prod/staging), commit chip (sha + author avatar), time, changed files chips, “View diff” link.
   * **Component:** `<DeployPanel />`
   * **Props:**

     ```ts
     type DeployPanelProps = {
       env:'prod'|'staging'; commit:{ sha:string; author:string; avatarUrl?:string; time:string };
       filesChanged?: string[]; diffUrl?: string;
     };
     ```
   * **Alt text:** `Prod deploy with commit, author, time, and changed files.`

3. **Repro**

   * **Panel title:** **Reproduction**
   * **Panel subtitle:** *Status & steps.*
   * **Graphic:** status badge `Reproduced in XmYs`, breadcrumb steps list (icons), “Open local session” button (Claude Code / VS Code / Cursor).
   * **Component:** `<ReproPanel />`
   * **Props:**

     ```ts
     type ReproPanelProps = {
       reproduced: boolean; duration?: string; breadcrumbs: string[];
       onOpenLocal?: () => void; editors?: ('Claude Code'|'VS Code'|'Cursor')[];
     };
     ```
   * **Alt text:** `Reproduction status with breadcrumbs and local session button.`

4. **Traces**

   * **Panel title:** **Traces**
   * **Panel subtitle:** *Hot path & spans.*
   * **Graphic:** mini waterfall (SVG) with highlighted span; metric chips like `P95 +38%` and route `/orders`.
   * **Component:** `<TracesPanel />`
   * **Props:**

     ```ts
     type TracesPanelProps = {
       spans: { name: string; ms: number }[]; highlightIndex?: number;
       metrics?: { p95DeltaPct?: number; route?: string }; traceUrl?: string;
     };
     ```
   * **Alt text:** `Trace waterfall highlighting slow span and P95 change.`

5. **Trend**

   * **Panel title:** **Errors**
   * **Panel subtitle:** *Last 24h.*
   * **Graphic:** sparkline with deploy/spike markers; counters (`37 /24h`, `−12%`); env chips (`prod`, `us-west-2`).
   * **Component:** `<TrendPanel />`
   * **Props:**

     ```ts
     type TrendPanelProps = {
       series: { t: number; v: number }[]; total24h: number; deltaPct: number;
       env?: { stage: string; region?: string }; markers?: { t:number; label:string }[];
     };
     ```
   * **Alt text:** `24-hour error trend with deploy and spike markers.`

---

## Interaction & accessibility (shared)

* Each card uses a **tablist** of pills (icons + short labels).
* Hover or keyboard-focus swaps the active panel; last active persists.
* ARIA: `role="tablist"`, tabs with `aria-controls` → `tabpanel`. Use roving tabindex + arrow keys.
* Motion: 150–200 ms fade + 8 px translate; honor `prefers-reduced-motion`.
* Empty states per panel: short one-liners (e.g., *“No recent PRs in the last 7 days.”*).

---

## Copy tokens (consistent labels)

* Card titles: **Org memory** / **Runtime**
* Panel titles: **Ownership**, **Recent PRs**,

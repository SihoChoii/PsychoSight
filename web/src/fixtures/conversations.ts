export interface MockConversation {
  id: string;
  label: string;
  handles: string[];
  message_count: number;
  latest_date: string | null;
  first_message_at: string | null;
  last_message_at: string | null;
  first_message_date: string | null;
  last_message_date: string | null;
  is_group: boolean;
  supported: boolean;
  is_demo: boolean;
  participant_count: number;
}

function stamp(day: string, hour = 12): string {
  return `${day}T${String(hour).padStart(2, "0")}:00:00-08:00`;
}

function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, date + days));
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function span(
  id: string,
  label: string,
  handles: string[],
  first: string,
  last: string,
  messageCount: number,
  extra: Partial<MockConversation> = {},
): MockConversation {
  const lastAt = extra.last_message_at ?? stamp(last);
  return {
    id,
    label,
    handles,
    message_count: messageCount,
    latest_date: extra.latest_date === undefined ? lastAt : extra.latest_date,
    first_message_at: extra.first_message_at === undefined ? stamp(first, 9) : extra.first_message_at,
    last_message_at: lastAt,
    first_message_date: first,
    last_message_date: last,
    is_group: extra.is_group ?? false,
    supported: extra.supported ?? !extra.is_group,
    is_demo: extra.is_demo ?? false,
    participant_count: extra.participant_count ?? 1,
  };
}

const FIRST = ["Casey", "Drew", "Eden", "Finn", "Gray", "Harper", "Indigo", "Jules", "Kai", "Logan", "Marlow", "Noel", "Oakley", "Parker", "Quinn", "Reese", "Shay", "Tatum", "Umber", "Val", "Winter", "Yael", "Zuri"];
const LAST = ["Nguyen", "Patel", "Garcia", "Kim", "Singh", "Brown", "Martin"];

function extras(): MockConversation[] {
  const rows: MockConversation[] = [];
  for (let i = 0; i < 53; i += 1) {
    const firstName = FIRST[i % FIRST.length];
    const lastName = LAST[Math.floor(i / FIRST.length) % LAST.length];
    const label = `${firstName} ${lastName}`;
    const last = addDays("2026-11-28", -i * 4);
    const first = addDays(last, -(40 + (i % 15) * 20));
    const group = i % 11 === 0;
    rows.push(
      span(`p-${String(i + 1).padStart(3, "0")}`, label, [`${firstName}.${lastName}`.toLowerCase(), `+1555${2000 + i}`], first, last, 20 + i * 11, {
        is_group: group,
        supported: !group,
        participant_count: group ? 4 : 1,
      }),
    );
  }
  return rows;
}

function byActivity(a: MockConversation, b: MockConversation): number {
  const left = a.latest_date ?? "";
  const right = b.latest_date ?? "";
  if (left !== right) return left < right ? 1 : -1;
  if (a.id !== b.id) return a.id < b.id ? 1 : -1;
  return 0;
}

export function buildMockCatalog(): MockConversation[] {
  const demo: MockConversation = {
    id: "demo",
    label: "Demo conversation (synthetic)",
    handles: ["demo"],
    message_count: 4259,
    latest_date: "2026-02-01T13:48:05-08:00",
    first_message_at: "2025-08-04T20:29:09-07:00",
    last_message_at: "2026-02-01T13:48:05-08:00",
    first_message_date: "2025-08-04",
    last_message_date: "2026-02-01",
    is_group: false,
    supported: true,
    is_demo: true,
    participant_count: 1,
  };
  const named: MockConversation[] = [
    demo,
    span("demo-jordan", "Jordan Lee (demo data)", ["jordan"], "2024-06-01", "2026-01-18", 1204, {
      is_demo: true,
      latest_date: "2026-01-18T19:04:00-08:00",
      last_message_at: "2026-01-18T19:04:00-08:00",
    }),
    span("demo-group", "Family chat (demo data)", ["family"], "2025-01-02", "2025-12-02", 86, {
      is_group: true,
      supported: false,
      is_demo: true,
      participant_count: 4,
      latest_date: "2025-12-02T11:00:00-08:00",
      last_message_at: "2025-12-02T11:00:00-08:00",
    }),
    {
      id: "riley",
      label: "Riley Chen",
      handles: ["riley", "riley.chen"],
      message_count: 18,
      latest_date: null,
      first_message_at: null,
      last_message_at: null,
      first_message_date: null,
      last_message_date: null,
      is_group: false,
      supported: true,
      is_demo: false,
      participant_count: 1,
    },
    {
      id: "1",
      label: "Bob Smith",
      handles: ["bob.smith", "+15550100"],
      message_count: 2,
      latest_date: "2025-03-20T08:00:00-07:00",
      first_message_at: "2025-03-01T07:00:00-08:00",
      last_message_at: "2025-03-20T08:00:00-07:00",
      first_message_date: "2025-03-01",
      last_message_date: "2025-03-20",
      is_group: false,
      supported: true,
      is_demo: false,
      participant_count: 1,
    },
    span("avery", "Avery Chen", ["avery.chen"], "2024-01-01", "2026-12-31", 800),
    span("short-span", "Short Span", ["short"], "2020-01-15", "2020-02-15", 12),
  ];
  const rest = named.filter((item) => item.id !== "demo").concat(extras()).sort(byActivity);
  return [demo, ...rest];
}

export const MOCK_CATALOG = buildMockCatalog();

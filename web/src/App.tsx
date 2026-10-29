import { useEffect, useState } from "react";
import { buildAnalysisRequest } from "./analysis-request";
import { ApiError, getClient } from "./api";
import { DiskAccess } from "./components/DiskAccess";
import { OptIn } from "./components/OptIn";
import { Picker, type PickerSelection } from "./components/Picker";
import { ProgressView } from "./components/ProgressView";
import { ReportView } from "./components/ReportView";
import { Shell } from "./components/Shell";
import { applyTheme, currentTheme, isMockMode, type ThemeName } from "./mode";
import { parseHash, type Route } from "./routes";
import type { Config, ConversationsResponse, ExperimentalChoice, Job, Report, SavedAnalysis } from "./types";

const SEL_KEY = "psychosight-selection";
const JOB_KEY = "psychosight-active-job";
const FLASH_KEY = "psychosight-flash";

function readSelection(): PickerSelection | null {
  try {
    const raw = sessionStorage.getItem(SEL_KEY);
    return raw ? (JSON.parse(raw) as PickerSelection) : null;
  } catch {
    return null;
  }
}

function rememberSelection(selection: PickerSelection): void {
  sessionStorage.setItem(SEL_KEY, JSON.stringify(selection));
}

export function App() {
  const mock = isMockMode();
  const [theme, setTheme] = useState<ThemeName>(() => currentTheme());
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationsResponse | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.getElementById("page-title")?.focus();
  }, [route]);

  useEffect(() => {
    let stop = false;
    getClient()
      .then((client) => client.getConfig())
      .then((next) => {
        if (!stop) setConfig(next);
      })
      .catch((error: unknown) => {
        if (!stop) setConfigError(error instanceof Error ? error.message : "The disclosure could not be loaded.");
      });
    return () => {
      stop = true;
    };
  }, [reload]);

  useEffect(() => {
    let stop = false;
    getClient()
      .then((client) => Promise.all([client.getConversations(), client.listAnalyses()]))
      .then(([nextConversations, nextSaved]) => {
        if (stop) return;
        setConversations(nextConversations);
        setSaved(nextSaved);
        setListError(null);
      })
      .catch((error: unknown) => {
        if (!stop) setListError(error instanceof Error ? error.message : "Conversations could not be loaded.");
      });
    return () => {
      stop = true;
    };
  }, [reload, route.name]);

  useEffect(() => {
    if (!conversations) return;
    const blocked = conversations.chat_db.available === false;
    if (blocked && route.name === "picker") window.location.hash = "#/access";
    if (!blocked && route.name === "access") window.location.hash = "#/";
  }, [conversations, route.name]);

  useEffect(() => {
    if (route.name !== "picker" && route.name !== "access") return;
    const value = sessionStorage.getItem(FLASH_KEY);
    if (!value) return;
    sessionStorage.removeItem(FLASH_KEY);
    setFlash(value);
  }, [route.name]);

  function toggleTheme() {
    const next: ThemeName = theme === "black" ? "white" : "black";
    applyTheme(next);
    setTheme(next);
  }

  async function start(optIn: boolean, choice: ExperimentalChoice) {
    const selection = readSelection();
    if (!selection) {
      window.location.hash = "#/";
      return;
    }
    setBusy(true);
    setSubmitError(null);
    try {
      const client = await getClient();
      const created = await client.createAnalysis(
        buildAnalysisRequest({
          conversationId: selection.conversationId,
          isDemo: selection.isDemo,
          dateFrom: selection.dateFrom,
          dateTo: selection.dateTo,
          llmOptIn: optIn,
          choice,
          config,
        }),
      );
      sessionStorage.setItem(JOB_KEY, created.job_id);
      window.location.hash = `#/run/${encodeURIComponent(created.job_id)}`;
    } catch (error: unknown) {
      setSubmitError(error instanceof ApiError ? error.message : "The analysis could not be started.");
    } finally {
      setBusy(false);
    }
  }

  const diskError = conversations?.chat_db.available === false ? conversations.chat_db.error : null;
  const activeJobId = sessionStorage.getItem(JOB_KEY);
  const footerDisclaimer = route.name === "report" ? null : (config?.disclaimer ?? null);

  let body = null;
  if (route.name === "optin") {
    const selection = readSelection();
    body = (
      <OptIn
        text={config?.opt_in_text ?? null}
        busy={busy}
        error={submitError ?? configError}
        isDemo={Boolean(selection?.isDemo || selection?.conversationId === "demo")}
        experimentalEnabled={config?.experimental_enabled === true}
        experimentalText={config?.experimental_opt_in_text ?? null}
        scoreOtherText={config?.score_other_opt_in_text ?? null}
        demoProviderNote={config?.demo_provider_note ?? null}
        onOptIn={(choice) => start(true, choice)}
        onLocalOnly={(choice) => start(false, choice)}
      />
    );
  } else if (route.name === "run") {
    body = <RunScreen jobId={route.jobId} />;
  } else if (route.name === "report") {
    body = <ReportScreen jobId={route.jobId} />;
  } else if (listError) {
    body = (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Conversations
        </h1>
        <p className="field-error" role="alert">
          {listError}
        </p>
        <div className="actions">
          <button type="button" className="button" onClick={() => setReload((value) => value + 1)}>
            Retry
          </button>
        </div>
      </section>
    );
  } else if (!conversations) {
    body = (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Conversations
        </h1>
        <p className="decision-copy">Loading conversations.</p>
      </section>
    );
  } else if (route.name === "access" || diskError) {
    body = (
      <>
        {flash ? (
          <p className="status-line" role="status">
            {flash}
          </p>
        ) : null}
        <DiskAccess
          message={diskError?.message ?? "Full Disk Access is required to read Messages."}
          onDemo={() => {
            const demo = conversations.conversations.find((item) => item.id === "demo");
            rememberSelection({
              conversationId: demo?.id ?? "demo",
              label: demo?.label ?? "Demo conversation (synthetic)",
              isDemo: true,
              dateFrom: "",
              dateTo: "",
            });
            window.location.hash = "#/optin";
          }}
        />
        {saved.length > 0 ? (
          <SavedLinks saved={saved} />
        ) : null}
      </>
    );
  } else {
    body = (
      <Picker
        theme={theme}
        conversations={conversations.conversations}
        saved={saved}
        activeJobId={activeJobId}
        flash={flash}
        onContinue={(selection) => {
          rememberSelection(selection);
          setSubmitError(null);
          window.location.hash = "#/optin";
        }}
      />
    );
  }

  return (
    <Shell theme={theme} onToggleTheme={toggleTheme} mock={mock} disclaimer={footerDisclaimer} route={route}>
      {body}
    </Shell>
  );
}

function SavedLinks({ saved }: { saved: SavedAnalysis[] }) {
  return (
    <section className="section" aria-labelledby="saved-title">
      <div className="section-heading">
        <h2 id="saved-title">Saved reports</h2>
      </div>
      <div className="rows">
        {saved.map((item) => (
          <a className="row link-row" key={item.job_id} href={`#/report/${encodeURIComponent(item.job_id)}`}>
            <span className="choice-label">{item.conversation_label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

function RunScreen({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer = 0;
    async function tick() {
      try {
        const client = await getClient();
        const next = await client.getAnalysis(jobId);
        if (stop) return;
        setJob(next);
        if (next.status === "done") {
          window.location.hash = `#/report/${encodeURIComponent(jobId)}`;
          return;
        }
        if (next.status === "error") return;
        timer = window.setTimeout(tick, 500);
      } catch (err: unknown) {
        if (!stop) setError(err instanceof Error ? err.message : "The analysis could not be read.");
      }
    }
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Stopped
        </h1>
        <p className="field-error" role="alert">
          {error}
        </p>
        <div className="actions">
          <a className="button button-secondary" href="#/">
            Conversations
          </a>
        </div>
      </section>
    );
  }

  return <ProgressView job={job} onBack={() => { window.location.hash = "#/"; }} />;
}

function ReportScreen({ jobId }: { jobId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    getClient()
      .then((client) => client.getReport(jobId))
      .then((next) => {
        if (!stop) setReport(next);
      })
      .catch((err: unknown) => {
        if (!stop) {
          setError(err instanceof ApiError ? err : new ApiError("INTERNAL_ERROR", "The report could not be loaded.", 0));
        }
      });
    return () => {
      stop = true;
    };
  }, [jobId]);

  async function remove() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const client = await getClient();
      await client.deleteAnalysis(jobId);
      if (sessionStorage.getItem(JOB_KEY) === jobId) sessionStorage.removeItem(JOB_KEY);
      sessionStorage.setItem(FLASH_KEY, "Report deleted.");
      window.location.hash = "#/";
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : "The report could not be deleted.");
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Report
        </h1>
        <p className="field-error" role="alert">
          {error.message}
        </p>
        {error.code === "REPORT_NOT_READY" ? (
          <div className="actions">
            <a className="button" href={`#/run/${encodeURIComponent(jobId)}`}>
              View progress
            </a>
          </div>
        ) : null}
      </section>
    );
  }
  if (!report) {
    return (
      <section className="focus-task" aria-labelledby="page-title">
        <h1 id="page-title" tabIndex={-1}>
          Report
        </h1>
        <p className="decision-copy">Loading the report.</p>
      </section>
    );
  }
  return <ReportView report={report} deleting={deleting} deleteError={deleteError} onDelete={remove} />;
}

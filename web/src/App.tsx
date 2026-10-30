import { useEffect, useRef, useState } from "react";
import { buildAnalysisRequest } from "./analysis-request";
import { ApiError, getClient } from "./api";
import type { ConversationPage } from "./conversation-adapter";
import { DiskAccess } from "./components/DiskAccess";
import { OptIn } from "./components/OptIn";
import { Picker, type PickerSelection } from "./components/Picker";
import { RunScreen } from "./components/RunScreen";
import { ReportScreen } from "./components/ReportScreen";
import { SavedReports } from "./components/SavedReports";
import { Shell } from "./components/Shell";
import { applyTheme, currentTheme, isMockMode, type ThemeName } from "./mode";
import { readReasoningControl } from "./reasoning-adapter";
import { parseHash, type Route } from "./routes";
import type { Config, ExperimentalChoice, SavedAnalysis } from "./types";
import { ACTIVE_JOB_KEY, isSelection, readSession, writeSession, removeSession, rememberRunContext } from "./run-context";

const SEL_KEY = "psychosight-selection";
const JOB_KEY = ACTIVE_JOB_KEY;
const FLASH_KEY = "psychosight-flash";

function readSelection(): PickerSelection | null {
  try {
    const raw = readSession(SEL_KEY);
    const selection: unknown = raw ? JSON.parse(raw) : null;
    return isSelection(selection) ? selection : null;
  } catch {
    return null;
  }
}

function rememberSelection(selection: PickerSelection): void {
  writeSession(SEL_KEY, JSON.stringify(selection));
}

export function App() {
  const mock = isMockMode();
  const [theme, setTheme] = useState<ThemeName>(() => currentTheme());
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const [selection, setSelection] = useState<PickerSelection | null>(readSelection);
  const [config, setConfig] = useState<Config | null>(null);
  const [configReload, setConfigReload] = useState(0);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ConversationPage | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedReload, setSavedReload] = useState(0);
  const [saved, setSaved] = useState<SavedAnalysis[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [accessNote, setAccessNote] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);

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
    setConfigLoading(true);
    setConfigError(null);
    getClient()
      .then((client) => client.getConfig())
      .then((next) => {
        if (!stop) setConfig(next);
      })
      .catch((error: unknown) => {
        if (!stop) setConfigError(error instanceof Error ? error.message : "The disclosure could not be loaded.");
      }).finally(() => { if (!stop) setConfigLoading(false); });
    return () => {
      stop = true;
    };
  }, [reload, configReload]);

  useEffect(() => {
    let stop = false;
    setSavedLoading(true);
    setListError(null);
    getClient()
      .then((client) => client.listAnalyses())
      .then((nextSaved) => {
        if (stop) return;
        setSaved(nextSaved);
        setListError(null);
      })
      .catch((error: unknown) => {
        if (!stop) setListError(error instanceof Error ? error.message : "Saved reports could not be loaded.");
      }).finally(() => { if (!stop) setSavedLoading(false); });
    return () => {
      stop = true;
    };
  }, [reload, savedReload, route.name]);

  useEffect(() => {
    if (!catalog) return;
    const blocked = catalog.chat_db.available === false;
    if (blocked && route.name === "picker") window.location.hash = "#/access";
    if (!blocked && route.name === "access") window.location.hash = "#/";
  }, [catalog, route.name]);

  useEffect(() => {
    if (route.name !== "picker" && route.name !== "access") return;
    const value = readSession(FLASH_KEY);
    if (!value) return;
    removeSession(FLASH_KEY);
    setFlash(value);
  }, [route.name]);

  function toggleTheme() {
    const next: ThemeName = theme === "black" ? "white" : "black";
    applyTheme(next);
    setTheme(next);
  }

  async function start(optIn: boolean, choice: ExperimentalChoice, reasoningLevel: string | null = null) {
    if (submitting.current) return;
    if (!selection) {
      window.location.hash = "#/";
      return;
    }
    submitting.current = true;
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
          reasoningLevel: optIn ? reasoningLevel : null,
        }),
      );
      rememberRunContext(created.job_id, selection);
      writeSession(JOB_KEY, created.job_id);
      window.location.hash = `#/run/${encodeURIComponent(created.job_id)}`;
    } catch (error: unknown) {
      setSubmitError(error instanceof ApiError ? error.message : "The analysis could not be started.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function openDiskSettings() {
    setAccessBusy(true);
    setAccessNote("Opening Full Disk Access Settings.");
    try {
      const client = await getClient();
      const result = await client.openDiskAccessSettings();
      setAccessNote(
        result.opened
          ? "System Settings should be open at Full Disk Access. Turn on PsychoSight, then quit and reopen the app."
          : "System Settings did not open. Go to Privacy & Security, Full Disk Access, and turn on PsychoSight.",
      );
    } catch (error: unknown) {
      setAccessNote(error instanceof Error ? error.message : "System Settings did not open.");
    } finally {
      setAccessBusy(false);
    }
  }

  async function recheckDisk() {
    setAccessBusy(true);
    setAccessNote("Checking Full Disk Access.");
    try {
      const client = await getClient();
      const result = await client.recheckDiskAccess();
      setAccessNote(result.message);
      if (result.granted) {
        setCatalog(null);
        setReload((value) => value + 1);
      }
    } catch (error: unknown) {
      setAccessNote(error instanceof Error ? error.message : "Full Disk Access could not be checked.");
    } finally {
      setAccessBusy(false);
    }
  }

  async function revealApp() {
    setAccessBusy(true);
    setAccessNote("Showing PsychoSight in Finder.");
    try {
      const client = await getClient();
      const result = await client.revealDiskAccessApp();
      setAccessNote(
        result.revealed
          ? "PsychoSight is selected in Finder. Drag it into the Full Disk Access list if it is missing, turn it on, then quit and reopen."
          : "PsychoSight could not be shown in Finder. Look in /Applications, then drag PsychoSight.app into the Full Disk Access list.",
      );
    } catch (error: unknown) {
      setAccessNote(error instanceof Error ? error.message : "PsychoSight could not be shown in Finder.");
    } finally {
      setAccessBusy(false);
    }
  }

  const diskError = catalog?.chat_db.available === false ? catalog.chat_db.error : null;
  const activeJobId = readSession(JOB_KEY);
  const footerDisclaimer = route.name === "report" ? null : (config?.disclaimer ?? null);

  const selectionIsDemo = Boolean(selection?.isDemo || selection?.conversationId === "demo");
  const experimentalChoicesAvailable = Boolean(
    config?.experimental_enabled && config.experimental_opt_in_text && config.score_other_opt_in_text,
  );

  let body = null;
  if (route.name === "optin") {
    // Config may arrive after a direct opt-in link. Initialize defaults when choices become available.
    body = (
      <OptIn
        key={`${selection?.conversationId ?? ""}:${selectionIsDemo}:${experimentalChoicesAvailable}`}
        selection={selection}
        text={config?.opt_in_text ?? null}
        busy={busy}
        error={submitError}
        configError={configError}
        configLoading={configLoading}
        onRetryConfig={() => setConfigReload((value) => value + 1)}
        isDemo={selectionIsDemo}
        experimentalEnabled={config?.experimental_enabled === true}
        experimentalText={config?.experimental_opt_in_text ?? null}
        scoreOtherText={config?.score_other_opt_in_text ?? null}
        demoProviderNote={config?.demo_provider_note ?? null}
        reasoningConfig={config}
        onOptIn={(choice, reasoningLevel) => start(true, choice, reasoningLevel)}
        onLocalOnly={(choice) => start(false, choice, null)}
      />
    );
  } else if (route.name === "run") {
    body = <RunScreen key={route.jobId} jobId={route.jobId} />;
  } else if (route.name === "report") {
    body = (
      <ReportScreen
        key={route.jobId}
        jobId={route.jobId}
        trendNote={config?.experimental_trend_note ?? null}
        reasoningLevels={readReasoningControl(config).levels}
      />
    );
  } else if (catalog?.chat_db.available === false) {
    body = (
      <>
        {flash ? (
          <p className="status-line" role="status">
            {flash}
          </p>
        ) : null}
        <DiskAccess
          message={diskError?.message ?? "Full Disk Access is required to read Messages."}
          note={accessNote}
          busy={accessBusy}
          onOpenSettings={() => void openDiskSettings()}
          onRecheck={() => void recheckDisk()}
          onReveal={() => void revealApp()}
          onDemo={() => {
            const demo = catalog.conversations.find((item) => item.id === "demo");
            const selection = {
              conversationId: demo?.id ?? "demo",
              label: demo?.label ?? "Demo conversation (synthetic)",
              isDemo: true,
              dateFrom: "",
              dateTo: "",
            };
            setSelection(selection);
            rememberSelection(selection);
            window.location.hash = "#/optin";
          }}
        />
        <SavedReports saved={saved} savedLoading={savedLoading} savedError={listError} onRetrySaved={() => setSavedReload((value) => value + 1)} />
      </>
    );
  } else {
    body = (
      <Picker
        saved={saved}
        savedLoading={savedLoading}
        savedError={listError}
        onRetrySaved={() => setSavedReload((value) => value + 1)}
        activeJobId={activeJobId}
        flash={flash}
        refreshKey={reload}
        onCatalog={setCatalog}
        onContinue={(selection) => {
          setSelection(selection);
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

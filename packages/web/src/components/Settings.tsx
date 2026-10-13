import { DEFAULT_SETTINGS } from "@sideshow/shared";
import { useState } from "react";
import { useA, useM } from "../model";
import { FONTS, fontChoice, loaded, setFont, type FontSlot } from "../fonts";
import { ALL_SANS } from "../fonts-sans";
import { setThemePref, themePref, type ThemePref } from "../theme";
import { Dialog } from "./Dialog";

// Two kinds of settings. Appearance belongs to this device (localStorage). The reducer's
// tunable rules are synced (every device and the server must apply the same thresholds),
// so a change to them applies everywhere. Things being tried out go on the Experimental tab.

const THEMES: { value: ThemePref; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const BLIP_OPTIONS = [0, 10, 30, 60, 120];
const GAP_OPTIONS = [0, 2, 5, 10, 15, 30, 60];

type Tab = "general" | "experimental";
const TABS: { value: Tab; label: string }[] = [
  { value: "general", label: "General" },
  { value: "experimental", label: "Experimental" },
];

export function SettingsDialog({ onClose, onClients }: { onClose: () => void; onClients: () => void }) {
  const [tab, setTab] = useState<Tab>("general");
  return (
    <Dialog title="Settings" onClose={onClose} className="settings">
      <div className="tabs settings-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.value}
            role="tab"
            id={`settings-tab-${t.value}`}
            aria-selected={tab === t.value}
            aria-controls="settings-panel"
            className={`tab ${tab === t.value ? "on" : ""}`}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === "general" ? <GeneralSettings onClients={onClients} /> : <ExperimentalSettings />}
      </div>
    </Dialog>
  );
}

/** Being tried out: may change or go away. */
function ExperimentalSettings() {
  return (
    <>
      <p className="muted small setting-help">Things being tried out. They may change or go away.</p>
      <h3 className="settings-group">On this device</h3>
      <FontSetting slot="header" label="Header font" />
      <FontSetting slot="app" label="App font" />
    </>
  );
}

function GeneralSettings({ onClients }: { onClients: () => void }) {
  const m = useM();
  const a = useA();
  const { blipSec, resumeGapMin } = m.settings;

  return (
    <>
      <h3 className="settings-group">On this device</h3>
      <ThemeSetting />

      <h3 className="settings-group">On every device</h3>

      {m.groupBy?.list && (
        <section className="setting">
          <span className="setting-label">{m.groupBy.label}s</span>
          <button className="btn setting-select" onClick={onClients}>
            {m.groupBy.label}s…
          </button>
          <p className="muted small setting-help">
            {m.config.cw
              ? `Link each ${m.groupBy.label.toLowerCase()} to its ConnectWise company, or remove ones you don't use.`
              : `Remove ${m.groupBy.label.toLowerCase()}s you don't use.`}
          </p>
        </section>
      )}

      <Setting
        label="Discard accidental starts"
        value={blipSec}
        options={BLIP_OPTIONS}
        format={(v) => (v === 0 ? "Off: keep every session" : `Under ${v < 60 ? `${v} seconds` : `${v / 60} minute${v === 60 ? "" : "s"}`}`)}
        defaultValue={DEFAULT_SETTINGS.blipSec}
        onChange={(v) => a.updateSettings({ blipSec: v })}
      >
        When a session ends this quickly and has <strong>no notes</strong>, it's thrown away, so tapping the
        wrong task doesn't leave junk entries. A task's only session is always kept, and so is anything
        you typed notes in.
      </Setting>

      <Setting
        label="Resume instead of starting a new session"
        value={resumeGapMin}
        options={GAP_OPTIONS}
        format={(v) => (v === 0 ? "Off: always a new session" : `Within ${v} minutes`)}
        defaultValue={DEFAULT_SETTINGS.resumeGapMin}
        onChange={(v) => a.updateSettings({ resumeGapMin: v })}
      >
        Coming back to a task this soon after its last session <strong>reopens that session</strong> (the
        gap counts as worked), so bouncing between tasks doesn't make a pile of tiny time entries. A
        session already marked entered is never reopened.
      </Setting>
    </>
  );
}

function ThemeSetting() {
  const [pref, setPref] = useState(themePref);
  return (
    <section className="setting">
      <span className="setting-label" id="theme-label">
        Colors
      </span>
      <span className="segmented" role="group" aria-labelledby="theme-label">
        {THEMES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={`seg ${pref === t.value ? "seg-on" : ""}`}
            aria-pressed={pref === t.value}
            onClick={() => {
              setPref(t.value);
              setThemePref(t.value);
            }}
          >
            {t.label}
          </button>
        ))}
      </span>
      <p className="muted small setting-help">System follows this device's light or dark mode, and switches when it does.</p>
    </section>
  );
}

/** TEMPORARY: try Google Fonts (fonts.ts). Arrow keys in the dropdown apply each one live. */
function FontSetting({ slot, label }: { slot: FontSlot; label: string }) {
  const [family, setFamily] = useState(() => fontChoice(slot));
  const [missing, setMissing] = useState(false);
  const id = `font-${slot}`;
  return (
    <section className="setting">
      <label htmlFor={id} className="setting-label">
        {label}
      </label>
      <select
        id={id}
        className="select setting-select"
        value={family}
        onChange={async (e) => {
          const f = e.target.value;
          setFamily(f);
          setMissing(false);
          const ok = await setFont(slot, f);
          if (fontChoice(slot) === f) setMissing(!ok);
        }}
      >
        <option value="">{slot === "app" ? "Bricolage Grotesque (default)" : "Unbounded (default)"}</option>
        <option value="system-ui">System font</option>
        <optgroup label="Your picks">
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
              {loaded.get(f) === false ? " (not on Google Fonts)" : ""}
            </option>
          ))}
        </optgroup>
        <optgroup label={`All ${ALL_SANS.length} sans-serif, most popular first`}>
          {ALL_SANS.filter((f) => !FONTS.includes(f)).map((f) => (
            <option key={f} value={f}>
              {f}
              {loaded.get(f) === false ? " (couldn't load)" : ""}
            </option>
          ))}
        </optgroup>
      </select>
      {missing && <p className="warn small setting-help">Google Fonts doesn't have “{family}”; showing the system font.</p>}
      {slot === "app" && (
        <p className="muted small setting-help">
          Applies to this device only. Focus a list and use the arrow keys to flip through them.
        </p>
      )}
    </section>
  );
}

function Setting({
  label,
  value,
  options,
  format,
  defaultValue,
  onChange,
  children,
}: {
  label: string;
  value: number;
  options: number[];
  format: (v: number) => string;
  defaultValue: number;
  onChange: (v: number) => void;
  children: React.ReactNode;
}) {
  const id = label.replace(/\W+/g, "-").toLowerCase();
  const all = options.includes(value) ? options : [...options, value].sort((x, y) => x - y);
  return (
    <section className="setting">
      <label htmlFor={id} className="setting-label">
        {label}
      </label>
      <select id={id} className="select setting-select" value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {all.map((v) => (
          <option key={v} value={v}>
            {format(v)}
            {v === defaultValue ? " (default)" : ""}
          </option>
        ))}
      </select>
      <p className="muted small setting-help">{children}</p>
    </section>
  );
}

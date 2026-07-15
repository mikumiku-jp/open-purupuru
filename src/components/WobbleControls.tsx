import { useId, useMemo, useState } from "react";
import { controlLocales } from "../control-locales";
import { useI18n } from "../i18n";
import { motionDebugLocales } from "../motion-debug-locales";
import { presetLocales } from "../preset-locales";
import { presetOrder, presets } from "../presets";
import { useDeviceMotion } from "../use-device-motion";
import type {
  AutoMotion,
  GravityDirection,
  Point,
  PresetId,
  WobbleParameters,
} from "../types";

type Props = {
  disabled: boolean;
  selectedPreset: PresetId;
  parameters: WobbleParameters;
  autoMotion: AutoMotion;
  autoStrength: number;
  autoPeriodMs: number;
  onPreset: (preset: PresetId) => void;
  onParameters: (parameters: WobbleParameters) => void;
  onAutoMotion: (motion: AutoMotion) => void;
  onAutoStrength: (strength: number) => void;
  onAutoPeriodMs: (periodMs: number) => void;
  onSensorTarget: (target: Point) => void;
};

type ParameterHeadingProps = {
  label: string;
  help: string;
  helpLabel: string;
  id: string;
  value?: React.ReactNode;
};

function ParameterHeading({
  label,
  help,
  helpLabel,
  id,
  value,
}: ParameterHeadingProps) {
  return (
    <span className="parameter-heading">
      <span className="parameter-name">
        {label}
        <span
          className="parameter-help-anchor"
          role="button"
          tabIndex={0}
          aria-label={helpLabel}
          aria-describedby={id}
          onClick={(event) => event.currentTarget.focus()}
          onKeyDown={(event) => {
            if (event.key !== " " && event.key !== "Enter") return;
            event.preventDefault();
            event.currentTarget.focus();
          }}
        />
        <span className="parameter-tooltip" id={id} role="tooltip">
          {help}
        </span>
      </span>
      {value}
    </span>
  );
}

function areParametersEqual(
  parameters: WobbleParameters,
  preset: WobbleParameters,
) {
  return (Object.keys(preset) as Array<keyof WobbleParameters>).every(
    (key) => parameters[key] === preset[key],
  );
}

export function WobbleControls(props: Props) {
  const { copy, language } = useI18n();
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const detailsId = `${useId().replaceAll(":", "")}-details`;
  const presetCopy = presetLocales[language];
  const controlCopy = controlLocales[language];
  const debugCopy = motionDebugLocales[language];
  const sensor = useDeviceMotion(props.onSensorTarget);
  const isSensorEnabled = sensor.status === "active" || sensor.status === "waiting";
  const isCustom = !areParametersEqual(
    props.parameters,
    presets[props.selectedPreset],
  );
  const isMotionDebugVisible = useMemo(
    () => new URLSearchParams(window.location.search).get("motionDebug") === "1",
    [],
  );
  const periodLabel = `${new Intl.NumberFormat(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(props.autoPeriodMs / 1000)}${copy.seconds}`;
  const helpLabel = (label: string) =>
    controlCopy.helpLabel.replace("{label}", label);

  async function toggleSensor() {
    if (isSensorEnabled) {
      sensor.disable();
      return;
    }
    await sensor.enable();
  }

  function updateParameter<K extends keyof WobbleParameters>(
    key: K,
    value: WobbleParameters[K],
  ) {
    props.onParameters({ ...props.parameters, [key]: value });
  }

  const parameterRanges: Array<{
    key: "stretch" | "damping" | "cohesion" | "variation";
    label: string;
  }> = [
    { key: "stretch", label: copy.stretch },
    { key: "damping", label: copy.damping },
    { key: "cohesion", label: copy.cohesion },
    { key: "variation", label: copy.variation },
  ];
  const gravityLabels: Record<GravityDirection, string> = {
    none: copy.gravityNone,
    down: copy.gravityDown,
    up: copy.gravityUp,
    left: copy.gravityLeft,
    right: copy.gravityRight,
  };

  return (
    <section
      className={`card play-controls${props.disabled ? " is-locked" : ""}`}
      aria-labelledby="play-controls-title"
      aria-disabled={props.disabled || undefined}
      inert={props.disabled || undefined}
    >
      <div className="section-heading">
        <h2 id="play-controls-title">{copy.wobbleSettings}</h2>
        <p>{copy.wobbleSettingsHelp}</p>
      </div>
      <fieldset className="play-controls-body" disabled={props.disabled}>
        <div className="preset-grid">
          {presetOrder.map((presetId) => {
            const isSelected = props.selectedPreset === presetId && !isCustom;
            return (
              <button
                key={presetId}
                type="button"
                className="preset-card"
                aria-pressed={isSelected}
                onClick={() => props.onPreset(presetId)}
              >
                <strong>
                  {isSelected ? "✓ " : ""}
                  {presetCopy[presetId].name}
                </strong>
                <span>{presetCopy[presetId].description}</span>
              </button>
            );
          })}
        </div>
        <section className={`settings-accordion${isDetailsOpen ? " is-open" : ""}`}>
          <button
            className="accordion-summary"
            type="button"
            aria-expanded={isDetailsOpen}
            aria-controls={detailsId}
            onClick={() => setIsDetailsOpen((current) => !current)}
          >
            <span>{copy.details}</span>
            <span className="accordion-chevron" aria-hidden="true">⌄</span>
          </button>
          <div
            className="accordion-panel"
            id={detailsId}
            aria-hidden={!isDetailsOpen}
            inert={!isDetailsOpen || undefined}
          >
            <div className="accordion-content">
              <div className="parameter-grid">
                {parameterRanges.map(({ key, label }) => (
                  <label className="range-control" key={key}>
                    <ParameterHeading
                      label={label}
                      help={controlCopy.fieldHelp[key]}
                      helpLabel={helpLabel(label)}
                      id={`parameter-help-${key}`}
                      value={<output>{props.parameters[key]}</output>}
                    />
                    <input
                      aria-label={label}
                      type="range"
                      min="0"
                      max="100"
                      value={props.parameters[key]}
                      onChange={(event) =>
                        updateParameter(key, Number(event.target.value))}
                    />
                  </label>
                ))}
                <label className="select-control">
                  <ParameterHeading
                    label={copy.gravityDirection}
                    help={controlCopy.fieldHelp.gravityDirection}
                    helpLabel={helpLabel(copy.gravityDirection)}
                    id="parameter-help-gravity-direction"
                  />
                  <select
                    value={props.parameters.gravityDirection}
                    onChange={(event) =>
                      updateParameter(
                        "gravityDirection",
                        event.target.value as GravityDirection,
                      )}
                  >
                    {(Object.keys(gravityLabels) as GravityDirection[]).map(
                      (direction) => (
                        <option key={direction} value={direction}>
                          {gravityLabels[direction]}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="range-control">
                  <ParameterHeading
                    label={copy.gravityStrength}
                    help={controlCopy.fieldHelp.gravityStrength}
                    helpLabel={helpLabel(copy.gravityStrength)}
                    id="parameter-help-gravity-strength"
                    value={
                      <output>{props.parameters.gravityStrength.toFixed(1)}G</output>
                    }
                  />
                  <input
                    aria-label={copy.gravityStrength}
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={props.parameters.gravityStrength}
                    onChange={(event) =>
                      updateParameter(
                        "gravityStrength",
                        Number(event.target.value),
                      )}
                  />
                </label>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    props.onParameters({ ...presets[props.selectedPreset] })}
                >
                  {copy.resetPreset}
                </button>
              </div>
            </div>
          </div>
        </section>
        <fieldset className="auto-motion-group">
          <legend>{copy.autoMotion}</legend>
          <p>{copy.autoHelp}</p>
          <div className="auto-motion-buttons">
            {(["sway", "hop", "orbit"] as const).map((motion) => (
              <button
                key={motion}
                type="button"
                aria-pressed={props.autoMotion === motion}
                onClick={() =>
                  props.onAutoMotion(props.autoMotion === motion ? null : motion)}
              >
                {copy[motion]}
              </button>
            ))}
          </div>
          <label className="range-control auto-motion-range">
            <span>
              {copy.autoStrength} <output>{props.autoStrength}%</output>
            </span>
            <input
              aria-label={copy.autoStrength}
              type="range"
              min="0"
              max="100"
              value={props.autoStrength}
              onChange={(event) =>
                props.onAutoStrength(Number(event.target.value))}
            />
          </label>
          <label className="range-control auto-motion-range">
            <span>
              {copy.autoPeriod} <output>{periodLabel}</output>
            </span>
            <input
              aria-label={copy.autoPeriod}
              aria-valuetext={periodLabel}
              type="range"
              min="200"
              max="1800"
              step="25"
              value={props.autoPeriodMs}
              onChange={(event) =>
                props.onAutoPeriodMs(Number(event.target.value))}
            />
          </label>
        </fieldset>
        <section
          className="mobile-motion-controls"
          aria-labelledby="mobile-motion-title"
        >
          <h3 id="mobile-motion-title">{controlCopy.sensor}</h3>
          <p className="sensor-help">{controlCopy.sensorHelp}</p>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void toggleSensor()}
          >
            {isSensorEnabled
              ? controlCopy.sensorDisable
              : controlCopy.sensorEnable}
          </button>
          {sensor.status === "denied" || sensor.status === "unsupported"
            ? <p role="status">{controlCopy.denied}</p>
            : null}
          {sensor.status === "waiting"
            ? <p role="status">{controlCopy.waiting}</p>
            : null}
        </section>
        {isMotionDebugVisible
          ? (
            <section
              className="sensor-debug-panel"
              aria-labelledby="sensor-debug-title"
            >
              <h3 id="sensor-debug-title">{debugCopy.title}</h3>
              <dl>
                <div><dt>{debugCopy.status}</dt><dd>{sensor.status}</dd></div>
                <div><dt>{debugCopy.source}</dt><dd>{sensor.debug.source}</dd></div>
                <div>
                  <dt>{debugCopy.angle}</dt>
                  <dd>{sensor.debug.screenAngle.toFixed(0)}°</dd>
                </div>
                <div>
                  <dt>{debugCopy.rate}</dt>
                  <dd>{sensor.debug.eventHz.toFixed(1)} Hz</dd>
                </div>
                <div>
                  <dt>{debugCopy.target}</dt>
                  <dd>
                    X {sensor.frameTarget.x.toFixed(4)} / Y {sensor.frameTarget.y.toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt>{debugCopy.magnitude}</dt>
                  <dd>
                    {(Math.hypot(sensor.frameTarget.x, sensor.frameTarget.y) * 100)
                      .toFixed(2)}%
                  </dd>
                </div>
              </dl>
              <p>{debugCopy.notice}</p>
            </section>
          )
          : null}
      </fieldset>
    </section>
  );
}

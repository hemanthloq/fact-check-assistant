"use client";

import { useLayoutEffect, useRef, useState } from "react";

/* ===========================================================================
   Hand-built SVG charts.

   Deliberately not a charting library: the specs below (<=24px marks, 4px
   rounded data-ends square at the baseline, 2px surface gaps between touching
   fills, 2px surface rings on dots, hairline solid gridlines, text in text
   tokens rather than series colours) are the whole point, and they are easier
   to hold exactly than to argue a library's defaults into.

   Colour: --color-chart-* only. Those four steps were validated as a set
   against this surface; the brighter verdict tones used for badges would fail
   the mark-contrast and lightness-band checks here.
   =========================================================================== */

const MARK_MAX = 24; // px, bar/column thickness cap
const GAP = 2; // px, surface gap between touching marks
const RADIUS = 4; // px, rounded data-end

/** Measures the container so marks land on whole pixels and text never scales. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    observer.observe(element);
    setWidth(Math.floor(element.getBoundingClientRect().width));
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

/* --------------------------------------------------------------------------
   Frame: title, note, legend, and the table view every chart must offer.
   -------------------------------------------------------------------------- */

export interface LegendItem {
  label: string;
  colour: string;
}

export function ChartFrame({
  title,
  note,
  legend,
  table,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  legend?: LegendItem[];
  /** Same numbers as the chart, for screen readers, CVD readers and print. */
  table?: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <section className={`panel p-5 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          {note && <p className="mt-1 max-w-prose text-xs leading-relaxed text-muted">{note}</p>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setShowTable((value) => !value)}
            aria-pressed={showTable}
            className="shrink-0 rounded-lg border border-line px-2.5 py-1 text-[0.7rem] text-muted transition-colors hover:border-line-bright hover:text-ink"
          >
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </div>

      {legend && legend.length > 1 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-2 text-xs text-ink-soft">
              <span
                className="size-2.5 shrink-0 rounded-[3px]"
                style={{ background: item.colour }}
                aria-hidden
              />
              {item.label}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {showTable && table ? (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-line">
                  {table.columns.map((column, index) => (
                    <th
                      key={column}
                      scope="col"
                      className={`py-2 font-medium text-muted ${index > 0 ? "text-right" : ""}`}
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-line/50 last:border-0">
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className={`py-1.5 ${cellIndex > 0 ? "nums text-right text-ink-soft" : "text-ink-soft"}`}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
   Tooltip
   -------------------------------------------------------------------------- */

function Tooltip({
  x,
  y,
  width,
  children,
}: {
  x: number;
  y: number;
  width: number;
  children: React.ReactNode;
}) {
  // Flip to the left of the cursor near the right edge so the tip never clips.
  const flip = x > width - 150;
  return (
    <div
      className="pointer-events-none absolute z-20 min-w-32 rounded-lg border border-line-bright bg-void/95 px-2.5 py-2 text-xs shadow-xl backdrop-blur-sm"
      style={{
        left: flip ? undefined : x + 12,
        right: flip ? width - x + 12 : undefined,
        top: Math.max(0, y - 10),
      }}
      role="status"
    >
      {children}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Stacked columns -- daily activity.
   Two series whose sum is the meaningful total (instant answers + escalations
   = submissions), which is exactly when stacking is honest.
   -------------------------------------------------------------------------- */

export interface ActivityPoint {
  day: string;
  instant: number;
  queued: number;
}

export function ActivityColumns({ data }: { data: ActivityPoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const height = 200;
  const padding = { top: 12, right: 8, bottom: 22, left: 34 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...data.map((point) => point.instant + point.queued));
  const ticks = niceTicks(max, 3);
  const scaleMax = ticks[ticks.length - 1];

  const band = data.length > 0 ? plotWidth / data.length : 0;
  const barWidth = Math.min(MARK_MAX, Math.max(2, band - GAP));

  const y = (value: number) => padding.top + plotHeight - (value / scaleMax) * plotHeight;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Daily submissions, stacked by outcome">
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--color-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y(tick) + 3.5}
                textAnchor="end"
                className="nums"
                fontSize={10}
                fill="var(--color-muted)"
              >
                {compact(tick)}
              </text>
            </g>
          ))}

          {data.map((point, index) => {
            const x = padding.left + index * band + (band - barWidth) / 2;
            const total = point.instant + point.queued;
            if (total === 0) return null;

            const instantHeight = (point.instant / scaleMax) * plotHeight;
            const queuedHeight = (point.queued / scaleMax) * plotHeight;
            // 2px surface gap between the two segments, taken out of the lower one.
            const instantDrawn = Math.max(0, instantHeight - (queuedHeight > 0 ? GAP : 0));

            return (
              <g
                key={point.day}
                onMouseEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                tabIndex={-1}
              >
                {/* Generous hit target: the whole band, not just the bar. */}
                <rect
                  x={padding.left + index * band}
                  y={padding.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                />
                {point.instant > 0 && (
                  <Bar
                    x={x}
                    y={padding.top + plotHeight - instantDrawn}
                    width={barWidth}
                    height={instantDrawn}
                    fill="var(--color-chart-good)"
                    roundTop={point.queued === 0}
                    dim={hover !== null && hover !== index}
                  />
                )}
                {point.queued > 0 && (
                  <Bar
                    x={x}
                    y={padding.top + plotHeight - instantHeight - queuedHeight}
                    width={barWidth}
                    height={queuedHeight}
                    fill="var(--color-chart-warn)"
                    roundTop
                    dim={hover !== null && hover !== index}
                  />
                )}
              </g>
            );
          })}

          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight}
            y2={padding.top + plotHeight}
            stroke="var(--color-chart-axis)"
            strokeWidth={1}
          />

          {/* Only the first and last day are labelled -- 30 tick labels is noise. */}
          {data.length > 0 && (
            <>
              <text
                x={padding.left}
                y={height - 6}
                fontSize={10}
                fill="var(--color-muted)"
                className="nums"
              >
                {shortDay(data[0].day)}
              </text>
              <text
                x={width - padding.right}
                y={height - 6}
                textAnchor="end"
                fontSize={10}
                fill="var(--color-muted)"
                className="nums"
              >
                {shortDay(data[data.length - 1].day)}
              </text>
            </>
          )}
        </svg>
      )}

      {hover !== null && data[hover] && (
        <Tooltip
          x={padding.left + hover * band + band / 2}
          y={40}
          width={width}
        >
          <p className="nums font-medium text-ink">{shortDay(data[hover].day, true)}</p>
          <dl className="mt-1.5 space-y-1">
            <Row
              colour="var(--color-chart-good)"
              label="Answered instantly"
              value={data[hover].instant}
            />
            <Row
              colour="var(--color-chart-warn)"
              label="Sent for review"
              value={data[hover].queued}
            />
          </dl>
        </Tooltip>
      )}

      <div
        className="absolute inset-0"
        onMouseMove={(event) => {
          if (band <= 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const index = Math.floor((event.clientX - bounds.left - padding.left) / band);
          setHover(index >= 0 && index < data.length ? index : null);
        }}
        onMouseLeave={() => setHover(null)}
      />
    </div>
  );
}

/** Bar with a 4px rounded data-end and a square baseline end. */
function Bar({
  x,
  y,
  width,
  height,
  fill,
  roundTop,
  dim,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  roundTop: boolean;
  dim?: boolean;
}) {
  if (height <= 0) return null;
  const r = roundTop ? Math.min(RADIUS, width / 2, height) : 0;
  const path = roundTop
    ? `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`
    : `M${x},${y} h${width} v${height} h${-width} Z`;
  return (
    <path
      d={path}
      fill={fill}
      opacity={dim ? 0.45 : 1}
      style={{ transition: "opacity 0.12s" }}
    />
  );
}

function Row({ colour, label, value }: { colour: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: colour }} aria-hidden />
      <dt className="text-muted">{label}</dt>
      <dd className="nums ml-auto text-ink">{value}</dd>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Horizontal bars -- verdict mix.
   Status colours grouped by truth polarity, with the verdict NAME on every
   row, so identity never depends on hue.
   -------------------------------------------------------------------------- */

export interface BarRow {
  label: string;
  value: number;
  colour: string;
}

export function HorizontalBars({ rows }: { rows: BarRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const labelWidth = 104;
  const valueWidth = 44;
  const rowHeight = 28;
  const barHeight = Math.min(MARK_MAX, rowHeight - 10);
  const max = Math.max(1, ...rows.map((row) => row.value));
  const trackWidth = Math.max(0, width - labelWidth - valueWidth);

  return (
    <div ref={ref}>
      {width > 0 && (
        <svg width={width} height={rows.length * rowHeight} role="img" aria-label="Claims by verdict">
          {rows.map((row, index) => {
            const y = index * rowHeight;
            const barWidth = (row.value / max) * trackWidth;
            return (
              <g key={row.label}>
                <text
                  x={0}
                  y={y + rowHeight / 2 + 3.5}
                  fontSize={11}
                  fill="var(--color-ink-soft)"
                >
                  {row.label}
                </text>
                <rect
                  x={labelWidth}
                  y={y + (rowHeight - barHeight) / 2}
                  width={trackWidth}
                  height={barHeight}
                  rx={2}
                  fill="var(--color-chart-grid)"
                />
                <Bar
                  x={labelWidth}
                  y={y + (rowHeight - barHeight) / 2}
                  width={Math.max(barWidth, row.value > 0 ? 3 : 0)}
                  height={barHeight}
                  fill={row.colour}
                  roundTop={false}
                />
                {/* Rounded data-end on the growing edge only. */}
                {barWidth > RADIUS && (
                  <rect
                    x={labelWidth + barWidth - RADIUS}
                    y={y + (rowHeight - barHeight) / 2}
                    width={RADIUS}
                    height={barHeight}
                    rx={RADIUS}
                    fill={row.colour}
                  />
                )}
                <text
                  x={width}
                  y={y + rowHeight / 2 + 3.5}
                  textAnchor="end"
                  fontSize={11}
                  className="nums"
                  fill="var(--color-ink)"
                >
                  {compact(row.value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Stacked horizontal bars -- verdict mix per topic.
   -------------------------------------------------------------------------- */

export interface StackRow {
  label: string;
  segments: { key: string; value: number; colour: string }[];
}

export function StackedBars({ rows }: { rows: StackRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ row: number; segment: number } | null>(null);
  const labelWidth = 96;
  const totalWidth = 44;
  const rowHeight = 30;
  const barHeight = Math.min(MARK_MAX, rowHeight - 12);
  const trackWidth = Math.max(0, width - labelWidth - totalWidth);
  const max = Math.max(
    1,
    ...rows.map((row) => row.segments.reduce((sum, segment) => sum + segment.value, 0)),
  );

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={rows.length * rowHeight}
          role="img"
          aria-label="Verdict mix by topic"
        >
          {rows.map((row, rowIndex) => {
            const y = rowIndex * rowHeight + (rowHeight - barHeight) / 2;
            const total = row.segments.reduce((sum, segment) => sum + segment.value, 0);
            let cursor = labelWidth;

            return (
              <g key={row.label}>
                <text
                  x={0}
                  y={rowIndex * rowHeight + rowHeight / 2 + 3.5}
                  fontSize={11}
                  fill="var(--color-ink-soft)"
                >
                  {row.label}
                </text>

                {row.segments.map((segment, segmentIndex) => {
                  if (segment.value === 0) return null;
                  const raw = (segment.value / max) * trackWidth;
                  const isLast = row.segments.slice(segmentIndex + 1).every((s) => s.value === 0);
                  // 2px surface gap between touching segments, one consistent width.
                  const segmentWidth = Math.max(1, raw - (isLast ? 0 : GAP));
                  const x = cursor;
                  cursor += raw;

                  const dim = hover !== null && (hover.row !== rowIndex || hover.segment !== segmentIndex);

                  return (
                    <rect
                      key={segment.key}
                      x={x}
                      y={y}
                      width={segmentWidth}
                      height={barHeight}
                      rx={isLast ? RADIUS : 0}
                      fill={segment.colour}
                      opacity={dim ? 0.4 : 1}
                      style={{ transition: "opacity 0.12s" }}
                      onMouseEnter={() => setHover({ row: rowIndex, segment: segmentIndex })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}

                <text
                  x={width}
                  y={rowIndex * rowHeight + rowHeight / 2 + 3.5}
                  textAnchor="end"
                  fontSize={11}
                  className="nums"
                  fill="var(--color-ink)"
                >
                  {compact(total)}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {hover !== null && rows[hover.row]?.segments[hover.segment] && (
        <Tooltip x={width / 2} y={hover.row * rowHeight} width={width}>
          <p className="font-medium text-ink">{rows[hover.row].label}</p>
          <Row
            colour={rows[hover.row].segments[hover.segment].colour}
            label={rows[hover.row].segments[hover.segment].key}
            value={rows[hover.row].segments[hover.segment].value}
          />
        </Tooltip>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Histogram -- one series, so one hue and no legend.
   -------------------------------------------------------------------------- */

export function Histogram({
  bins,
  xLabel,
}: {
  bins: { label: string; value: number }[];
  xLabel?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 150;
  const padding = { top: 10, right: 4, bottom: 30, left: 30 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = height - padding.top - padding.bottom;
  const max = Math.max(1, ...bins.map((bin) => bin.value));
  const ticks = niceTicks(max, 2);
  const scaleMax = ticks[ticks.length - 1];
  const band = bins.length > 0 ? plotWidth / bins.length : 0;
  const barWidth = Math.min(MARK_MAX, Math.max(3, band - GAP));

  return (
    <div ref={ref} className="relative">
      {width > 0 && bins.length > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label="Distribution of match similarity scores"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={padding.top + plotHeight - (tick / scaleMax) * plotHeight}
                y2={padding.top + plotHeight - (tick / scaleMax) * plotHeight}
                stroke="var(--color-chart-grid)"
                strokeWidth={1}
              />
              <text
                x={padding.left - 6}
                y={padding.top + plotHeight - (tick / scaleMax) * plotHeight + 3.5}
                textAnchor="end"
                fontSize={10}
                className="nums"
                fill="var(--color-muted)"
              >
                {compact(tick)}
              </text>
            </g>
          ))}

          {bins.map((bin, index) => {
            const barHeight = (bin.value / scaleMax) * plotHeight;
            const x = padding.left + index * band + (band - barWidth) / 2;
            return (
              <g
                key={bin.label}
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              >
                <rect
                  x={padding.left + index * band}
                  y={padding.top}
                  width={band}
                  height={plotHeight}
                  fill="transparent"
                />
                <Bar
                  x={x}
                  y={padding.top + plotHeight - barHeight}
                  width={barWidth}
                  height={barHeight}
                  fill="var(--color-chart-series)"
                  roundTop
                  dim={hover !== null && hover !== index}
                />
                {/* Only every other bin gets a tick label, so they never collide. */}
                {index % 2 === 0 && (
                  <text
                    x={padding.left + index * band + band / 2}
                    y={height - 16}
                    textAnchor="middle"
                    fontSize={9}
                    className="nums"
                    fill="var(--color-muted)"
                  >
                    {bin.label.split("-")[0]}
                  </text>
                )}
              </g>
            );
          })}

          <line
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + plotHeight}
            y2={padding.top + plotHeight}
            stroke="var(--color-chart-axis)"
            strokeWidth={1}
          />

          {xLabel && (
            <text
              x={padding.left + plotWidth / 2}
              y={height - 2}
              textAnchor="middle"
              fontSize={9.5}
              fill="var(--color-muted)"
            >
              {xLabel}
            </text>
          )}
        </svg>
      )}

      {hover !== null && bins[hover] && (
        <Tooltip x={padding.left + hover * band + band / 2} y={20} width={width}>
          <p className="nums font-medium text-ink">similarity {bins[hover].label}</p>
          <p className="nums mt-1 text-muted">
            {bins[hover].value} match{bins[hover].value === 1 ? "" : "es"}
          </p>
        </Tooltip>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Sparkline -- for the hero figure. One series, de-emphasised, last point
   carries the accent and a surface ring so it reads as "now".
   -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  width = 132,
  height = 36,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const stepX = width / (values.length - 1);
  const y = (value: number) => height - 3 - (value / max) * (height - 8);
  const points = values.map((value, index) => [index * stepX, y(value)] as const);
  const line = points.map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg width={width} height={height} aria-hidden className="overflow-visible">
      <path d={area} fill="var(--color-chart-series)" opacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="var(--color-chart-series)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.75}
      />
      {/* >=8px marker with a 2px surface ring. */}
      <circle cx={lastX} cy={lastY} r={4} fill="var(--color-chart-series)" />
      <circle
        cx={lastX}
        cy={lastY}
        r={4}
        fill="none"
        stroke="var(--color-panel)"
        strokeWidth={2}
      />
    </svg>
  );
}

/* --------------------------------------------------------------------------
   Figures
   -------------------------------------------------------------------------- */

export function StatTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p
        className="mt-1.5 text-2xl leading-none font-semibold tracking-tight"
        style={tone ? { color: tone } : undefined}
      >
        {value}
      </p>
      {note && <p className="mt-1.5 text-[0.7rem] leading-snug text-muted">{note}</p>}
    </div>
  );
}

/** The one number the dashboard leads with. */
export function HeroFigure({
  label,
  value,
  note,
  spark,
}: {
  label: string;
  value: string;
  note: string;
  spark?: number[];
}) {
  return (
    <div className="panel flex flex-col justify-between gap-4 p-5 sm:flex-row sm:items-end">
      <div>
        <p className="label-xs">{label}</p>
        <p className="mt-2 text-5xl leading-none font-semibold tracking-tight text-ink">{value}</p>
        <p className="mt-2.5 max-w-sm text-xs leading-relaxed text-ink-soft">{note}</p>
      </div>
      {spark && spark.length > 1 && (
        <div className="shrink-0">
          <Sparkline values={spark} />
          <p className="mt-1 text-right text-[0.65rem] text-muted">last 30 days</p>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */

/** Axis ticks at 1/2/5 x 10^n, so labels are always clean numbers. */
function niceTicks(max: number, count: number): number[] {
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Math.round(value));
  if (ticks.length < 2) ticks.push(step);
  return ticks;
}

function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

function shortDay(iso: string, long = false): string {
  const date = new Date(`${iso}T00:00:00`);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(long ? { year: "numeric" } : {}),
  });
}

/** Re-exported so pages can keep every chart colour in one place. */
export const CHART_COLOURS = {
  good: "var(--color-chart-good)",
  warn: "var(--color-chart-warn)",
  bad: "var(--color-chart-bad)",
  series: "var(--color-chart-series)",
} as const;


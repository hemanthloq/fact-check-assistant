"use client";

import type { AdminStats } from "@/lib/analytics";
import {
  ActivityColumns,
  CHART_COLOURS,
  ChartFrame,
  Histogram,
  HorizontalBars,
  StackedBars,
} from "./charts";
import { MATCH_THRESHOLD } from "@/lib/thresholds";
import { VERDICT_META, type Verdict } from "@/lib/types";

/**
 * Colour by meaning, consistently across every chart on this page: green means the
 * corpus resolved it, amber means a human is needed, red means the claim is false.
 * That mapping is the same one the verdict badges use everywhere else in the app, so
 * nothing has to be re-learned per chart.
 */
const VERDICT_COLOUR: Record<Verdict, string> = {
  true: CHART_COLOURS.good,
  mostly_true: CHART_COLOURS.good,
  half_true: CHART_COLOURS.warn,
  mostly_false: CHART_COLOURS.bad,
  false: CHART_COLOURS.bad,
  pants_on_fire: CHART_COLOURS.bad,
};

export function AdminCharts({ stats }: { stats: AdminStats }) {
  const activity = stats.activity.map((day) => ({
    day: day.day,
    instant: day.instant_matches,
    // v_daily_activity counts a day's submissions by their CURRENT status, so a claim
    // submitted then reviewed has moved out of 'awaiting_review'. Deriving the escalated
    // count as "everything that wasn't answered instantly" keeps the stack summing to the
    // day's real submission total instead of quietly losing the reviewed ones.
    queued: Math.max(0, day.submissions - day.instant_matches),
  }));

  const hasActivity = activity.some((day) => day.instant + day.queued > 0);

  const verdictRows = stats.verdictMix
    .filter((row) => row.count > 0)
    .map((row) => ({
      label: VERDICT_META[row.verdict].label,
      value: row.count,
      colour: VERDICT_COLOUR[row.verdict],
    }));

  const categoryRows = stats.categories.slice(0, 10).map((category) => ({
    label: category.name,
    segments: [
      { key: "True-ish", value: Number(category.true_ish), colour: CHART_COLOURS.good },
      { key: "Half true", value: Number(category.mixed), colour: CHART_COLOURS.warn },
      { key: "False-ish", value: Number(category.false_ish), colour: CHART_COLOURS.bad },
    ],
  }));

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      <ChartFrame
        className="lg:col-span-2"
        title="Submissions per day, by outcome"
        note="Stacked because the two parts sum to something real: every submission is either answered from the corpus or sent to a person. The green share is the work the corpus saved."
        legend={[
          { label: "Answered instantly", colour: CHART_COLOURS.good },
          { label: "Sent for review", colour: CHART_COLOURS.warn },
        ]}
        table={{
          columns: ["Day", "Answered instantly", "Sent for review", "Total"],
          rows: activity
            .filter((day) => day.instant + day.queued > 0)
            .map((day) => [day.day, day.instant, day.queued, day.instant + day.queued]),
        }}
      >
        {hasActivity ? (
          <ActivityColumns data={activity} />
        ) : (
          <Empty>No submissions in the last 30 days.</Empty>
        )}
      </ChartFrame>

      <ChartFrame
        title="Corpus by verdict"
        note="The LIAR import keeps the six-rung PolitiFact scale, so the corpus inherits its real distribution rather than a balanced one."
        legend={[
          { label: "True / mostly true", colour: CHART_COLOURS.good },
          { label: "Half true", colour: CHART_COLOURS.warn },
          { label: "Mostly false / false / pants on fire", colour: CHART_COLOURS.bad },
        ]}
        table={{
          columns: ["Verdict", "Claims"],
          rows: stats.verdictMix.map((row) => [VERDICT_META[row.verdict].label, row.count]),
        }}
      >
        {verdictRows.length > 0 ? (
          <HorizontalBars rows={verdictRows} />
        ) : (
          <Empty>The corpus is empty. Run `npm run db:setup`.</Empty>
        )}
      </ChartFrame>

      <ChartFrame
        title="Verdict mix by topic"
        note="From v_category_breakdown. Topics are many-to-many, so a claim about vaccine funding counts under both Health and Economy."
        legend={[
          { label: "True-ish", colour: CHART_COLOURS.good },
          { label: "Half true", colour: CHART_COLOURS.warn },
          { label: "False-ish", colour: CHART_COLOURS.bad },
        ]}
        table={{
          columns: ["Topic", "True-ish", "Half true", "False-ish", "Mean confidence"],
          rows: stats.categories.map((category) => [
            category.name,
            Number(category.true_ish),
            Number(category.mixed),
            Number(category.false_ish),
            category.avg_credibility === null ? "--" : Number(category.avg_credibility).toFixed(3),
          ]),
        }}
      >
        {categoryRows.length > 0 ? (
          <StackedBars rows={categoryRows} />
        ) : (
          <Empty>No categorised claims yet.</Empty>
        )}
      </ChartFrame>

      <ChartFrame
        className="lg:col-span-2"
        title="How close the instant answers actually were"
        note={`Similarity of every match the system acted on. Nothing can appear below the ${MATCH_THRESHOLD.toFixed(2)} threshold by construction -- if the mass sits right on the bar rather than well above it, the threshold is doing more work than the embeddings are, and is worth re-calibrating.`}
        table={{
          columns: ["Similarity band", "Matches"],
          rows: stats.similarityBuckets.map((bucket) => [bucket.bucket, bucket.count]),
        }}
      >
        {stats.similarityBuckets.length > 0 ? (
          <Histogram
            bins={stats.similarityBuckets.map((bucket) => ({
              label: bucket.bucket,
              value: bucket.count,
            }))}
            xLabel="cosine similarity to the matched corpus claim"
          />
        ) : (
          <Empty>No instant matches recorded yet.</Empty>
        )}
      </ChartFrame>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-32 place-items-center rounded-lg border border-dashed border-line">
      <p className="text-xs text-muted">{children}</p>
    </div>
  );
}

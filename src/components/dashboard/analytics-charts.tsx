"use client";

import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

// ─── Types ───
interface RecommendationData {
  name: string;
  value: number;
  color: string;
}

interface ConfidenceBucket {
  range: string;
  count: number;
}

interface ScanTrend {
  label: string;
  scans: number;
  contacts: number;
}

export interface AnalyticsData {
  recommendations: RecommendationData[];
  confidenceBuckets: ConfidenceBucket[];
  scanTrends: ScanTrend[];
  successRate: number;
  noResultRate: number;
  noResultCount: number;
  failureRate: number;
  totalJobs: number;
}

// ─── Custom tooltip matching glass theme ───
function GlassTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-card rounded-lg px-3 py-2 text-xs shadow-lg border border-border/50">
      {label && <p className="text-muted-foreground mb-1">{label}</p>}
      {payload.map((entry, i) => (
        <p key={i} style={{ color: entry.color }} className="font-medium">
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// ─── Recommendation Donut ───
function RecommendationChart({ data }: { data: RecommendationData[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
        No recommendations yet
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6">
      <div className="w-[140px] h-[140px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={65}
              paddingAngle={3}
              dataKey="value"
              stroke="none"
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-2">
        {data.map((entry) => (
          <div key={entry.name} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-muted-foreground">{entry.name}</span>
            <span className="text-xs font-semibold text-foreground ml-auto pl-3">
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Confidence Distribution ───
function ConfidenceChart({ data }: { data: ConfidenceBucket[] }) {
  const hasData = data.some((d) => d.count > 0);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
        No confidence data yet
      </div>
    );
  }

  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barCategoryGap="20%">
          <XAxis
            dataKey="range"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<GlassTooltip />} />
          <Bar
            dataKey="count"
            name="Contacts"
            fill="#4f6ef7"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Scan Trend (Area Chart) ───
function ScanTrendChart({ data }: { data: ScanTrend[] }) {
  const hasData = data.some((d) => d.scans > 0 || d.contacts > 0);

  if (!hasData) {
    return (
      <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
        No scan history yet
      </div>
    );
  }

  return (
    <div className="h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="scanGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#4f6ef7" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#4f6ef7" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="contactGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<GlassTooltip />} />
          <Area
            type="monotone"
            dataKey="scans"
            name="Scans"
            stroke="#4f6ef7"
            fill="url(#scanGradient)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="contacts"
            name="Contacts"
            stroke="#22c55e"
            fill="url(#contactGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Success Rate Ring ───
function SuccessRateRing({
  successRate,
  noResultRate,
  noResultCount,
  failureRate,
  totalJobs,
}: {
  successRate: number;
  noResultRate: number;
  noResultCount: number;
  failureRate: number;
  totalJobs: number;
}) {
  if (totalJobs === 0) {
    return (
      <div className="flex items-center justify-center h-[180px] text-sm text-muted-foreground">
        No jobs processed yet
      </div>
    );
  }

  const circumference = 2 * Math.PI * 52;
  const successOffset = circumference - (successRate / 100) * circumference;

  return (
    <div className="flex items-center gap-6">
      <div className="relative w-[130px] h-[130px]">
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
          <circle cx="60" cy="60" r="52" stroke="#e8ecf4" strokeWidth="10" fill="none" />
          <circle
            cx="60" cy="60" r="52"
            stroke="#22c55e"
            strokeWidth="10"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={successOffset}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-foreground">
            {Math.round(successRate)}%
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        <div>
          <p className="text-xs text-muted-foreground">Resolved</p>
          <p className="text-sm font-semibold text-success">{Math.round(successRate)}%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">No Result</p>
          <p className="text-sm font-semibold text-warning">
            {Math.round(noResultRate)}%
            {noResultCount > 0 && (
              <span className="text-xs font-normal text-muted-foreground ml-1">({noResultCount})</span>
            )}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Failed</p>
          <p className="text-sm font-semibold text-danger">{Math.round(failureRate)}%</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-sm font-semibold text-foreground">{totalJobs}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Main Analytics Component ───
export default function AnalyticsCharts({ data }: { data: AnalyticsData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
      {/* Recommendation Breakdown */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Recommendations
        </h3>
        <RecommendationChart data={data.recommendations} />
      </div>

      {/* Success Rate */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Processing Success
        </h3>
        <SuccessRateRing
          successRate={data.successRate}
          noResultRate={data.noResultRate}
          noResultCount={data.noResultCount}
          failureRate={data.failureRate}
          totalJobs={data.totalJobs}
        />
      </div>

      {/* Confidence Distribution */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Confidence Distribution
        </h3>
        <ConfidenceChart data={data.confidenceBuckets} />
      </div>

      {/* Scan Trends */}
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">
          Activity (Last 8 Weeks)
        </h3>
        <ScanTrendChart data={data.scanTrends} />
      </div>
    </div>
  );
}

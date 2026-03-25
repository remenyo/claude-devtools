import { assessmentColor } from '@renderer/utils/reportAssessments';
import { Activity } from 'lucide-react';

import { ReportSection } from '../ReportSection';

import type { ReportOverview } from '@renderer/types/sessionReport';

interface OverviewSectionProps {
  data: ReportOverview;
}

export const OverviewSection = ({ data }: OverviewSectionProps) => {
  return (
    <ReportSection title="Overview" icon={Activity}>
      <div className="mb-3 truncate text-xs text-text-muted">{data.firstMessage}</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <div className="text-xs text-text-muted">Duration</div>
          <div className="text-sm font-medium text-text">{data.durationHuman}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Messages</div>
          <div className="text-sm font-medium text-text">{data.totalMessages.toLocaleString()}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Context Usage</div>
          <div
            className="text-sm font-medium"
            style={{ color: assessmentColor(data.contextAssessment) }}
          >
            {data.contextConsumptionPct != null ? `${data.contextConsumptionPct}%` : 'N/A'}
            {data.contextAssessment && (
              <span className="ml-1 text-xs">({data.contextAssessment})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Compactions</div>
          <div className="text-sm font-medium text-text">{data.compactionCount}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Branch</div>
          <div className="truncate text-sm font-medium text-text">{data.gitBranch}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Subagents</div>
          <div className="text-sm font-medium text-text">{data.hasSubagents ? 'Yes' : 'No'}</div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Project</div>
          <div className="truncate text-sm font-medium text-text" title={data.projectPath}>
            {data.projectPath}
          </div>
        </div>
        <div>
          <div className="text-xs text-text-muted">Session ID</div>
          <div className="truncate text-sm font-medium text-text" title={data.sessionId}>
            {data.sessionId.slice(0, 12)}...
          </div>
        </div>

        {/* Nuanced Model Usage display */}
        {data.effortLevel && (
          <div>
            <div className="text-xs text-text-muted">Effort Level</div>
            <div className="text-sm font-medium text-text capitalize">
              {data.effortLevel.replace('_', ' ')}
            </div>
          </div>
        )}
      </div>

      {data.effortLevelCounts && (
        <div className="mt-4 pt-3 border-t border-border">
          <div className="mb-2 text-xs font-semibold text-text-muted">Effort Breakdown</div>
          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="rounded bg-blue-500/10 py-1">
              <div className="text-[10px] uppercase text-blue-400">Low</div>
              <div className="text-sm font-medium text-text">{data.effortLevelCounts.low || 0}</div>
            </div>
            <div className="rounded bg-green-500/10 py-1">
              <div className="text-[10px] uppercase text-green-400">Medium</div>
              <div className="text-sm font-medium text-text">{data.effortLevelCounts.medium || 0}</div>
            </div>
            <div className="rounded bg-yellow-500/10 py-1">
              <div className="text-[10px] uppercase text-yellow-400">High</div>
              <div className="text-sm font-medium text-text">{data.effortLevelCounts.high || 0}</div>
            </div>
            <div className="rounded bg-red-500/10 py-1">
              <div className="text-[10px] uppercase text-red-400">Max</div>
              <div className="text-sm font-medium text-text">{data.effortLevelCounts.max_effort || 0}</div>
            </div>
          </div>
        </div>
      )}
    </ReportSection>
  );
};

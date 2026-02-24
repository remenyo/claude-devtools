import { useState } from 'react';

import { api } from '@renderer/api';
import { aggregateReports } from '@renderer/utils/reportAggregator';
import { analyzeSession } from '@renderer/utils/sessionAnalyzer';

import { SessionReportTab } from './SessionReportTab';

import type { SessionReport } from '@renderer/types/sessionReport';
import type { Tab } from '@renderer/types/tabs';

interface AnalyticsTabProps {
  tab: Tab;
}

export const AnalyticsTab = ({ tab }: AnalyticsTabProps) => {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const startAnalysis = async () => {
    setIsAnalyzing(true);
    setError(null);
    setReport(null);
    setProgress({ current: 0, total: 0 });

    try {
      let sessionIds: { projectId: string; sessionId: string }[] = [];

      if (tab.scope === 'project' && tab.projectId) {
        // Fetch sessions for project
        const sessions = await api.getSessions(tab.projectId);
        sessionIds = sessions.map((s) => ({ projectId: tab.projectId!, sessionId: s.id }));
      } else if (tab.scope === 'global') {
        // Fetch all projects then all sessions
        const projects = await api.getProjects();
        for (const p of projects) {
          try {
            const sessions = await api.getSessions(p.id);
            sessionIds.push(...sessions.map((s) => ({ projectId: p.id, sessionId: s.id })));
          } catch (e) {
            console.error(`Failed to fetch sessions for project ${p.name}:`, e);
          }
        }
      }

      if (sessionIds.length === 0) {
        setError('No sessions found to analyze.');
        setIsAnalyzing(false);
        return;
      }

      setProgress({ current: 0, total: sessionIds.length });

      const reports: SessionReport[] = [];
      const CHUNK_SIZE = 5; // Concurrency limit

      for (let i = 0; i < sessionIds.length; i += CHUNK_SIZE) {
        const chunk = sessionIds.slice(i, i + CHUNK_SIZE);
        const promises = chunk.map(async ({ projectId, sessionId }) => {
          try {
            const detail = await api.getSessionDetail(projectId, sessionId);
            if (detail) {
              return analyzeSession(detail);
            }
          } catch (e) {
            console.error(`Failed to analyze session ${sessionId}:`, e);
          }
          return null;
        });

        const results = await Promise.all(promises);
        results.forEach((r) => {
          if (r) reports.push(r);
        });

        setProgress((prev) => ({ ...prev, current: Math.min(prev.total, i + CHUNK_SIZE) }));

        // Yield to main thread briefly to update UI
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      if (reports.length === 0) {
        setError('Failed to analyze any sessions.');
      } else {
        const aggregated = aggregateReports(reports);
        setReport(aggregated);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unknown error occurred during analysis');
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (report) {
      return (
          <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b p-4" style={{ backgroundColor: 'var(--color-surface-sidebar)', borderColor: 'var(--color-border)' }}>
                  <span className="font-semibold text-text">
                      {tab.scope === 'project' ? 'Project Analytics' : 'Global Analytics'}
                  </span>
                  <button
                      onClick={startAnalysis}
                      className="rounded px-3 py-1 text-sm font-medium text-white transition-colors hover:bg-blue-600"
                      style={{ backgroundColor: 'var(--color-accent)' }}
                  >
                      Re-analyze
                  </button>
              </div>
              <div className="flex-1 overflow-hidden">
                  <SessionReportTab tab={tab} report={report} />
              </div>
          </div>
      );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center" style={{ backgroundColor: 'var(--color-surface)' }}>
      <h1 className="text-2xl font-bold text-text">
        {tab.scope === 'project' ? 'Project Analytics' : 'Global Analytics'}
      </h1>
      <p className="max-w-md text-text-muted">
        Analyze {tab.scope === 'project' ? 'all sessions in this project' : 'all sessions across all projects'} to generate a comprehensive report.
        This process reads every session file and may take some time.
      </p>

      {error && (
        <div className="rounded-md bg-red-500/10 p-4 text-red-500">
          {error}
        </div>
      )}

      {isAnalyzing ? (
        <div className="w-full max-w-md space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${(progress.current / Math.max(progress.total, 1)) * 100}%` }}
            />
          </div>
          <p className="text-sm text-text-muted">
            Analyzing session {progress.current} of {progress.total}...
          </p>
        </div>
      ) : (
        <button
          onClick={startAnalysis}
          className="rounded-lg px-6 py-3 font-semibold text-white transition-transform hover:scale-105 active:scale-95"
          style={{ backgroundColor: 'var(--color-accent)' }}
        >
          Start Analysis
        </button>
      )}
    </div>
  );
};

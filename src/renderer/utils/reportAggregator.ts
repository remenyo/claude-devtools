import {
  computeCacheEfficiencyAssessment,
  computeCacheRatioAssessment,
  computeCostPerCommitAssessment,
  computeCostPerLineAssessment,
  computeIdleAssessment,
  computeOverheadAssessment,
  computeRedundancyAssessment,
  computeSubagentCostShareAssessment,
  computeThrashingAssessment,
  computeToolHealthAssessment,
} from '@renderer/utils/reportAssessments';

import type {
  ModelTokenStats,
  ReportCostAnalysis,
  SessionReport,
  ToolError,
  ToolSuccessRate,
} from '@renderer/types/sessionReport';

// Helper to format duration if not exported
function formatDurationLocal(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function aggregateReports(reports: SessionReport[]): SessionReport | null {
  if (reports.length === 0) return null;
  if (reports.length === 1) return reports[0];

  const count = reports.length;

  // --- Overview ---
  const totalDurationSeconds = reports.reduce((sum, r) => sum + r.overview.durationSeconds, 0);
  const totalMessages = reports.reduce((sum, r) => sum + r.overview.totalMessages, 0);
  const totalCompactionCount = reports.reduce((sum, r) => sum + r.overview.compactionCount, 0);
  const totalContextConsumption = reports.reduce((sum, r) => sum + r.overview.contextConsumption, 0);

  // --- Token Usage ---
  const byModel: Record<string, ModelTokenStats> = {};
  for (const r of reports) {
    for (const [model, stats] of Object.entries(r.tokenUsage.byModel)) {
      if (!byModel[model]) {
        byModel[model] = { ...stats };
      } else {
        const ag = byModel[model];
        ag.apiCalls += stats.apiCalls;
        ag.inputTokens += stats.inputTokens;
        ag.outputTokens += stats.outputTokens;
        ag.cacheCreation += stats.cacheCreation;
        ag.cacheRead += stats.cacheRead;
        ag.costUsd += stats.costUsd;
      }
    }
  }

  const tokenTotals = {
    inputTokens: reports.reduce((sum, r) => sum + r.tokenUsage.totals.inputTokens, 0),
    outputTokens: reports.reduce((sum, r) => sum + r.tokenUsage.totals.outputTokens, 0),
    cacheCreation: reports.reduce((sum, r) => sum + r.tokenUsage.totals.cacheCreation, 0),
    cacheRead: reports.reduce((sum, r) => sum + r.tokenUsage.totals.cacheRead, 0),
    grandTotal: reports.reduce((sum, r) => sum + r.tokenUsage.totals.grandTotal, 0),
    cacheReadPct: 0,
  };
  tokenTotals.cacheReadPct = tokenTotals.grandTotal
    ? Math.round((tokenTotals.cacheRead / tokenTotals.grandTotal) * 10000) / 100
    : 0;

  // --- Cost Analysis ---
  const parentCostUsd = reports.reduce((sum, r) => sum + r.costAnalysis.parentCostUsd, 0);
  const subagentCostUsd = reports.reduce((sum, r) => sum + r.costAnalysis.subagentCostUsd, 0);
  const totalSessionCostUsd = reports.reduce((sum, r) => sum + r.costAnalysis.totalSessionCostUsd, 0);

  const costByModel: Record<string, number> = {};
  for (const r of reports) {
      for (const [model, cost] of Object.entries(r.costAnalysis.costByModel)) {
          costByModel[model] = (costByModel[model] || 0) + cost;
      }
  }

  // --- Tool Usage ---
  const toolCounts: Record<string, number> = {};
  const toolErrors: Record<string, number> = {};
  for (const r of reports) {
    for (const [tool, cnt] of Object.entries(r.toolUsage.counts)) {
      toolCounts[tool] = (toolCounts[tool] || 0) + cnt;
    }
    for (const [tool, rate] of Object.entries(r.toolUsage.successRates)) {
      toolErrors[tool] = (toolErrors[tool] || 0) + rate.errors;
    }
  }

  const toolSuccessRates: Record<string, ToolSuccessRate> = {};
  for (const [tool, cnt] of Object.entries(toolCounts)) {
    const errCount = toolErrors[tool] || 0;
    const successPct = cnt ? Math.round(((cnt - errCount) / cnt) * 1000) / 10 : 0;
    toolSuccessRates[tool] = {
      totalCalls: cnt,
      errors: errCount,
      successRatePct: successPct,
      assessment: computeToolHealthAssessment(successPct),
    };
  }

  // Overall tool health
  const significantTools = Object.values(toolSuccessRates).filter((t) => t.totalCalls > 5);
  type THAssessment = 'healthy' | 'degraded' | 'unreliable';
  const overallToolHealth: THAssessment =
    significantTools.length > 0
      ? significantTools.reduce<THAssessment>((worst, t) => {
          const order = { healthy: 0, degraded: 1, unreliable: 2 } as const;
          return order[t.assessment] > order[worst] ? t.assessment : worst;
        }, 'healthy')
      : computeToolHealthAssessment(100);

  // --- Errors ---
  const allErrors: ToolError[] = reports.flatMap((r) => r.errors.errors);
  const allDenials = reports.flatMap((r) => r.errors.permissionDenials.denials);
  const affectedTools = [...new Set(allDenials.map((d) => d.tool))];

  // --- Git Activity ---
  const commitCount = reports.reduce((sum, r) => sum + r.gitActivity.commitCount, 0);
  const pushCount = reports.reduce((sum, r) => sum + r.gitActivity.pushCount, 0);
  const linesAdded = reports.reduce((sum, r) => sum + r.gitActivity.linesAdded, 0);
  const linesRemoved = reports.reduce((sum, r) => sum + r.gitActivity.linesRemoved, 0);
  const linesChanged = linesAdded + linesRemoved;
  const commits = reports.flatMap(r => r.gitActivity.commits); // Might be too many, but let's keep them for now.
  const branchCreations = reports.flatMap(r => r.gitActivity.branchCreations);

  // --- Subagents ---
  const subagentEntries = reports.flatMap((r) => r.subagentMetrics.byAgent);
  const subagentsList = reports.flatMap((r) => r.subagentsList);

  const saMetrics = {
    count: reports.reduce((sum, r) => sum + r.subagentMetrics.count, 0),
    totalTokens: reports.reduce((sum, r) => sum + r.subagentMetrics.totalTokens, 0),
    totalDurationMs: reports.reduce((sum, r) => sum + r.subagentMetrics.totalDurationMs, 0),
    totalToolUseCount: reports.reduce((sum, r) => sum + r.subagentMetrics.totalToolUseCount, 0),
    totalCostUsd: reports.reduce((sum, r) => sum + r.subagentMetrics.totalCostUsd, 0),
    byAgent: subagentEntries,
  };

  // --- Assessments recalculation ---
  const costPerCommitVal = commitCount > 0 ? Math.round((totalSessionCostUsd / commitCount) * 10000) / 10000 : null;
  const costPerLineVal = linesChanged > 0 ? Math.round((totalSessionCostUsd / linesChanged) * 1000000) / 1000000 : null;
  const subagentCostSharePct = totalSessionCostUsd > 0 ? Math.round((subagentCostUsd / totalSessionCostUsd) * 10000) / 100 : null;

  const costAnalysis: ReportCostAnalysis = {
      parentCostUsd,
      subagentCostUsd,
      totalSessionCostUsd,
      costByModel,
      costPerCommit: costPerCommitVal,
      costPerLineChanged: costPerLineVal,
      costPerCommitAssessment: costPerCommitVal != null ? computeCostPerCommitAssessment(costPerCommitVal) : null,
      costPerLineAssessment: costPerLineVal != null ? computeCostPerLineAssessment(costPerLineVal) : null,
      subagentCostSharePct,
      subagentCostShareAssessment: subagentCostSharePct != null ? computeSubagentCostShareAssessment(subagentCostSharePct) : null,
  };

  // --- Cache Economics ---
  const totalCacheRead = tokenTotals.cacheRead;
  const totalCacheCreation = tokenTotals.cacheCreation;
  const cacheTotalCreationAndRead = totalCacheCreation + totalCacheRead;
  const cacheEfficiency = cacheTotalCreationAndRead
    ? Math.round((totalCacheRead / cacheTotalCreationAndRead) * 10000) / 100
    : 0;
  const cacheRwRatio = totalCacheCreation
    ? Math.round((totalCacheRead / totalCacheCreation) * 10) / 10
    : 0;

  // --- Friction ---
  const correctionCount = reports.reduce((sum, r) => sum + r.frictionSignals.correctionCount, 0);
  const corrections = reports.flatMap(r => r.frictionSignals.corrections);
  const totalUserMessages = reports.reduce((sum, r) => sum + r.promptQuality.userMessageCount, 0);
  const frictionRate = totalUserMessages ? Math.round((correctionCount / totalUserMessages) * 10000) / 10000 : 0;

  // --- Thrashing ---
  const bashNearDuplicates = reports.flatMap(r => r.thrashingSignals.bashNearDuplicates); // This might be long
  const editReworkFiles = reports.flatMap(r => r.thrashingSignals.editReworkFiles);
  const thrashingSignalCount = bashNearDuplicates.length + editReworkFiles.length; // Approximate, but good enough indicator

  // --- Idle Analysis ---
  const totalIdleSeconds = reports.reduce((sum, r) => sum + r.idleAnalysis.totalIdleSeconds, 0);
  const wallClockSeconds = totalDurationSeconds;
  const activeWorkingSeconds = reports.reduce((sum, r) => sum + r.idleAnalysis.activeWorkingSeconds, 0);
  const idleGapCount = reports.reduce((sum, r) => sum + r.idleAnalysis.idleGapCount, 0);
  const idlePct = wallClockSeconds > 0 ? Math.round((totalIdleSeconds / wallClockSeconds) * 1000) / 10 : 0;

  // --- Startup Overhead ---
  const startupMessages = reports.reduce((sum, r) => sum + r.startupOverhead.messagesBeforeFirstWork, 0);
  const startupTokens = reports.reduce((sum, r) => sum + r.startupOverhead.tokensBeforeFirstWork, 0);
  const startupPctOfTotal = tokenTotals.grandTotal ? Math.round((startupTokens / tokenTotals.grandTotal) * 10000) / 100 : 0;

  // --- File Redundancy ---
  const totalReads = reports.reduce((sum, r) => sum + r.fileReadRedundancy.totalReads, 0);
  const uniqueFiles = reports.reduce((sum, r) => sum + r.fileReadRedundancy.uniqueFiles, 0); // This is just sum of unique files per session, not globally unique
  const readsPerUniqueFile = uniqueFiles ? Math.round((totalReads / uniqueFiles) * 100) / 100 : 0;

  // --- Lists ---
  const skillsInvoked = reports.flatMap(r => r.skillsInvoked);
  // Reconstruct bash stats
  const bashTotal = reports.reduce((sum, r) => sum + r.bashCommands.total, 0);
  const bashUnique = 0; // Hard to calculate without raw data

  const lifecycleTasks = reports.flatMap(r => r.lifecycleTasks);
  const userQuestions = reports.flatMap(r => r.userQuestions);
  const outOfScopeFindings = reports.flatMap(r => r.outOfScopeFindings);

  return {
    overview: {
      sessionId: 'aggregated',
      projectId: reports[0].overview.projectId, // Assuming all from same project if scoped to project
      projectPath: reports[0].overview.projectPath,
      firstMessage: `Aggregated report for ${count} sessions`,
      messageCount: totalMessages,
      hasSubagents: reports.some(r => r.overview.hasSubagents),
      contextConsumption: totalContextConsumption,
      contextConsumptionPct: null, // Not meaningful aggregated
      contextAssessment: null,
      compactionCount: totalCompactionCount,
      gitBranch: 'multiple',
      startTime: null, // Could take min
      endTime: null, // Could take max
      durationSeconds: totalDurationSeconds,
      durationHuman: formatDurationLocal(Math.floor(totalDurationSeconds)),
      totalMessages: totalMessages,
    },
    tokenUsage: {
      byModel,
      totals: tokenTotals,
    },
    costAnalysis,
    cacheEconomics: {
      cacheRead: totalCacheRead,
      cacheEfficiencyPct: cacheEfficiency,
      coldStartDetected: false,
      cacheReadToWriteRatio: cacheRwRatio,
      cacheEfficiencyAssessment: cacheTotalCreationAndRead > 0 ? computeCacheEfficiencyAssessment(cacheEfficiency) : null,
      cacheRatioAssessment: totalCacheCreation > 0 ? computeCacheRatioAssessment(cacheRwRatio) : null,
    },
    toolUsage: {
      counts: toolCounts,
      totalCalls: Object.values(toolCounts).reduce((a, b) => a + b, 0),
      successRates: toolSuccessRates,
      overallToolHealth,
    },
    subagentMetrics: saMetrics,
    subagentsList,
    errors: {
      errors: allErrors,
      permissionDenials: {
        count: allDenials.length,
        denials: allDenials,
        affectedTools,
      },
    },
    gitActivity: {
      commitCount,
      commits,
      pushCount,
      branchCreations,
      linesAdded,
      linesRemoved,
      linesChanged,
    },
    frictionSignals: {
      correctionCount,
      corrections,
      frictionRate,
    },
    thrashingSignals: {
      bashNearDuplicates,
      editReworkFiles,
      thrashingAssessment: computeThrashingAssessment(thrashingSignalCount / count), // Average thrashing?
    },
    conversationTree: {
      totalNodes: reports.reduce((sum, r) => sum + r.conversationTree.totalNodes, 0),
      maxDepth: Math.max(...reports.map(r => r.conversationTree.maxDepth)),
      sidechainCount: reports.reduce((sum, r) => sum + r.conversationTree.sidechainCount, 0),
      branchPoints: reports.reduce((sum, r) => sum + r.conversationTree.branchPoints, 0),
      branchDetails: [], // Too detailed
    },
    idleAnalysis: {
      idleThresholdSeconds: 60,
      idleGapCount,
      totalIdleSeconds,
      totalIdleHuman: formatDurationLocal(Math.floor(totalIdleSeconds)),
      wallClockSeconds,
      activeWorkingSeconds,
      activeWorkingHuman: formatDurationLocal(Math.floor(activeWorkingSeconds)),
      idlePct,
      longestGaps: [], // Too detailed
      idleAssessment: computeIdleAssessment(idlePct),
    },
    modelSwitches: {
      count: reports.reduce((sum, r) => sum + r.modelSwitches.count, 0),
      switches: [], // Too detailed
      modelsUsed: [...new Set(reports.flatMap(r => r.modelSwitches.modelsUsed))],
      switchPattern: null,
    },
    workingDirectories: {
      uniqueDirectories: [...new Set(reports.flatMap(r => r.workingDirectories.uniqueDirectories))],
      directoryCount: 0, // Recalculate if needed
      changes: [],
      changeCount: reports.reduce((sum, r) => sum + r.workingDirectories.changeCount, 0),
      isMultiDirectory: false,
    },
    testProgression: {
      snapshotCount: reports.reduce((sum, r) => sum + r.testProgression.snapshotCount, 0),
      snapshots: [],
      trajectory: 'insufficient_data',
      firstSnapshot: null,
      lastSnapshot: null,
    },
    startupOverhead: {
      messagesBeforeFirstWork: startupMessages,
      tokensBeforeFirstWork: startupTokens,
      pctOfTotal: startupPctOfTotal,
      overheadAssessment: computeOverheadAssessment(startupPctOfTotal),
    },
    tokenDensityTimeline: { quartiles: [] }, // Hard to aggregate
    promptQuality: {
      firstMessageLengthChars: 0,
      userMessageCount: totalUserMessages,
      correctionCount,
      frictionRate,
      assessment: 'well_specified', // Default
      note: 'Aggregated stats',
    },
    thinkingBlocks: {
      count: reports.reduce((sum, r) => sum + r.thinkingBlocks.count, 0),
      analyzedCount: 0,
      signalSummary: {},
      notableBlocks: [],
    },
    keyEvents: [],
    messageTypes: {}, // Could sum
    fileReadRedundancy: {
      totalReads,
      uniqueFiles,
      readsPerUniqueFile,
      redundantFiles: {},
      redundancyAssessment: computeRedundancyAssessment(readsPerUniqueFile),
    },
    compaction: {
      count: totalCompactionCount,
      compactSummaryCount: reports.reduce((sum, r) => sum + r.compaction.compactSummaryCount, 0),
      note: '',
    },
    gitBranches: [...new Set(reports.flatMap(r => r.gitBranches))],
    skillsInvoked,
    bashCommands: {
      total: bashTotal,
      unique: bashUnique,
      repeated: {}, // Lost fidelity
    },
    lifecycleTasks,
    userQuestions,
    outOfScopeFindings,
    agentTree: {
        agentCount: 0,
        agents: [],
        hasTeamMode: false,
        teamNames: [],
    },
  };
}

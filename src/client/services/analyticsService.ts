/**
 * Analytics Service
 * Tracks and stores local coding activity data
 */

import * as vscode from 'vscode';

export interface ActivityRecord {
  date: string;        // "2024-12-29" format
  hour: number;        // 0-23
  project: string;
  language: string;
  minutes: number;     // Aggregated time in this bucket
}

export interface AnalyticsSummary {
  totalMinutes: number;
  byLanguage: Map<string, number>;
  byProject: Map<string, number>;
  byHour: Map<number, number>;
}

const STORAGE_KEY = 'vscord.analytics';
const RETENTION_DAYS = 90;
const AGGREGATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class AnalyticsService {
  private records: ActivityRecord[] = [];
  private aggregationTimer: NodeJS.Timeout | null = null;
  private currentProject = '';
  private currentLanguage = '';
  private trackingEnabled = true;
  private lastActivityTime = Date.now();

  constructor(private context: vscode.ExtensionContext) { }

  /**
   * Initialize analytics service
   */
  async initialize(): Promise<void> {
    // Load existing records
    const stored = this.context.globalState.get<ActivityRecord[]>(STORAGE_KEY);
    if (stored) {
      this.records = stored;
    }

    // Check if tracking is enabled
    const config = vscode.workspace.getConfiguration('vscord');
    this.trackingEnabled = config.get<boolean>('analyticsEnabled', true);

    // Cleanup old records
    await this.cleanupOldRecords();

    // Start aggregation timer
    this.startAggregation();

    console.log(`[Analytics] Loaded ${this.records.length} records`);
  }

  /**
   * Update current activity
   */
  updateActivity(project: string, language: string): void {
    if (!this.trackingEnabled) return;

    this.currentProject = project || 'Unknown';
    this.currentLanguage = language || 'Unknown';
    this.lastActivityTime = Date.now();
  }

  /**
   * Start the aggregation timer
   */
  private startAggregation(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
    }

    this.aggregationTimer = setInterval(() => {
      this.recordActivity();
    }, AGGREGATION_INTERVAL_MS);
  }

  /**
   * Record current activity into storage
   */
  private async recordActivity(): Promise<void> {
    if (!this.trackingEnabled) return;

    // Only record if there was recent activity (within 10 minutes)
    const timeSinceActivity = Date.now() - this.lastActivityTime;
    if (timeSinceActivity > 10 * 60 * 1000) return;

    if (!this.currentProject || !this.currentLanguage) return;

    const now = new Date();
    const date = now.toISOString().split('T')[0]!;
    const hour = now.getHours();

    // Find existing record for this bucket
    const existing = this.records.find(
      r => r.date === date &&
        r.hour === hour &&
        r.project === this.currentProject &&
        r.language === this.currentLanguage
    );

    if (existing) {
      existing.minutes += 5;
    } else {
      this.records.push({
        date,
        hour,
        project: this.currentProject,
        language: this.currentLanguage,
        minutes: 5,
      });
    }

    // Persist to storage
    await this.context.globalState.update(STORAGE_KEY, this.records);
  }

  /**
   * Cleanup records older than retention period
   */
  private async cleanupOldRecords(): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]!;

    const before = this.records.length;
    this.records = this.records.filter(r => r.date >= cutoffStr);

    if (this.records.length < before) {
      await this.context.globalState.update(STORAGE_KEY, this.records);
      console.log(`[Analytics] Cleaned up ${before - this.records.length} old records`);
    }
  }

  /**
   * Get summary for today
   */
  getTodaySummary(): AnalyticsSummary {
    const today = new Date().toISOString().split('T')[0]!;
    return this.getSummaryForDates([today]);
  }

  /**
   * Get summary for the last 7 days
   */
  getWeeklySummary(): AnalyticsSummary {
    const dates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]!);
    }
    return this.getSummaryForDates(dates);
  }

  /**
   * Get summary for specific dates
   */
  getSummaryForDates(dates: string[]): AnalyticsSummary {
    const filtered = this.records.filter(r => dates.includes(r.date));

    const byLanguage = new Map<string, number>();
    const byProject = new Map<string, number>();
    const byHour = new Map<number, number>();
    let totalMinutes = 0;

    for (const record of filtered) {
      totalMinutes += record.minutes;

      byLanguage.set(
        record.language,
        (byLanguage.get(record.language) ?? 0) + record.minutes
      );

      byProject.set(
        record.project,
        (byProject.get(record.project) ?? 0) + record.minutes
      );

      byHour.set(
        record.hour,
        (byHour.get(record.hour) ?? 0) + record.minutes
      );
    }

    return { totalMinutes, byLanguage, byProject, byHour };
  }

  /**
   * Get heatmap data for the week
   * Returns a 7x24 grid of activity intensity
   */
  getWeeklyHeatmap(): number[][] {
    // 7 days x 24 hours
    const heatmap: number[][] = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, () => 0)
    );

    const today = new Date();

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(today);
      d.setDate(d.getDate() - (6 - dayOffset)); // Start from 6 days ago
      const dateStr = d.toISOString().split('T')[0]!;

      const dayRecords = this.records.filter(r => r.date === dateStr);
      for (const record of dayRecords) {
        heatmap[dayOffset]![record.hour] += record.minutes;
      }
    }

    return heatmap;
  }

  /**
   * Get all records (for export)
   */
  getAllRecords(): ActivityRecord[] {
    return [...this.records];
  }

  /**
   * Format minutes as "Xh Ym"
   */
  static formatDuration(minutes: number): string {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m`;
    }
    return `${mins}m`;
  }

  /**
   * Dispose the service
   */
  dispose(): void {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
  }
}

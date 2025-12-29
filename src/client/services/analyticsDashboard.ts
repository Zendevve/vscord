/**
 * Analytics Dashboard Provider
 * Webview panel for displaying coding analytics
 */

import * as vscode from 'vscode';
import { AnalyticsService } from './analyticsService';

export class AnalyticsDashboard {
  private panel: vscode.WebviewPanel | null = null;

  constructor(private analytics: AnalyticsService) { }

  /**
   * Open or focus the dashboard panel
   */
  show(): void {
    if (this.panel) {
      this.panel.reveal();
      this.updateContent();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'vscordAnalytics',
      'VSCord Analytics',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.updateContent();
  }

  /**
   * Update the webview content
   */
  private updateContent(): void {
    if (!this.panel) return;

    const today = this.analytics.getTodaySummary();
    const weekly = this.analytics.getWeeklySummary();
    const heatmap = this.analytics.getWeeklyHeatmap();

    this.panel.webview.html = this.getHtml(today, weekly, heatmap);
  }

  /**
   * Generate the dashboard HTML
   */
  private getHtml(
    today: ReturnType<AnalyticsService['getTodaySummary']>,
    weekly: ReturnType<AnalyticsService['getWeeklySummary']>,
    heatmap: number[][]
  ): string {
    const todayDuration = AnalyticsService.formatDuration(today.totalMinutes);
    const weeklyDuration = AnalyticsService.formatDuration(weekly.totalMinutes);

    // Sort languages by time
    const languagesSorted = [...today.byLanguage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Sort projects by time
    const projectsSorted = [...weekly.byProject.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // Generate heatmap cells
    const maxHeatmapValue = Math.max(...heatmap.flat(), 1);
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    // Adjust days to start from 6 days ago
    const todayIdx = new Date().getDay();
    const orderedDays: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dayIdx = (todayIdx - 6 + i + 7) % 7;
      orderedDays.push(days[dayIdx === 0 ? 6 : dayIdx - 1]!);
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --accent: var(--vscode-button-background);
      --border: var(--vscode-panel-border);
      --card-bg: var(--vscode-editorWidget-background);
    }

    body {
      font-family: var(--vscode-font-family);
      background: var(--bg);
      color: var(--fg);
      padding: 20px;
      margin: 0;
    }

    h1 {
      font-size: 24px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .dashboard {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }

    .card h2 {
      font-size: 14px;
      text-transform: uppercase;
      opacity: 0.7;
      margin: 0 0 12px 0;
    }

    .big-number {
      font-size: 36px;
      font-weight: bold;
      color: var(--accent);
      margin-bottom: 16px;
    }

    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .bar-item {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .bar-label {
      width: 100px;
      font-size: 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .bar-container {
      flex: 1;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      height: 20px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 4px;
      transition: width 0.3s ease;
    }

    .bar-value {
      width: 60px;
      text-align: right;
      font-size: 12px;
      opacity: 0.8;
    }

    .heatmap {
      display: grid;
      grid-template-columns: 40px repeat(7, 1fr);
      gap: 2px;
      font-size: 10px;
    }

    .heatmap-header {
      text-align: center;
      padding: 4px;
      opacity: 0.7;
    }

    .heatmap-hour {
      text-align: right;
      padding-right: 8px;
      opacity: 0.7;
    }

    .heatmap-cell {
      aspect-ratio: 1;
      border-radius: 2px;
      min-height: 12px;
    }

    .level-0 { background: rgba(255,255,255,0.05); }
    .level-1 { background: rgba(74, 222, 128, 0.2); }
    .level-2 { background: rgba(74, 222, 128, 0.4); }
    .level-3 { background: rgba(74, 222, 128, 0.6); }
    .level-4 { background: rgba(74, 222, 128, 0.8); }
    .level-5 { background: rgba(74, 222, 128, 1.0); }

    .empty-state {
      text-align: center;
      padding: 40px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <h1>📊 Coding Analytics</h1>

  <div class="dashboard">
    <!-- Today Summary -->
    <div class="card">
      <h2>Today</h2>
      <div class="big-number">${todayDuration}</div>
      ${languagesSorted.length > 0 ? `
        <div class="bar-chart">
          ${languagesSorted.map(([lang, mins]) => {
      const pct = (mins / (languagesSorted[0]?.[1] ?? 1)) * 100;
      return `
              <div class="bar-item">
                <span class="bar-label">${lang}</span>
                <div class="bar-container">
                  <div class="bar-fill" style="width: ${pct}%"></div>
                </div>
                <span class="bar-value">${AnalyticsService.formatDuration(mins)}</span>
              </div>
            `;
    }).join('')}
        </div>
      ` : '<div class="empty-state">No activity recorded today</div>'}
    </div>

    <!-- Weekly Summary -->
    <div class="card">
      <h2>This Week</h2>
      <div class="big-number">${weeklyDuration}</div>
      ${projectsSorted.length > 0 ? `
        <div class="bar-chart">
          ${projectsSorted.slice(0, 5).map(([proj, mins]) => {
      const pct = (mins / (projectsSorted[0]?.[1] ?? 1)) * 100;
      return `
              <div class="bar-item">
                <span class="bar-label" title="${proj}">${proj}</span>
                <div class="bar-container">
                  <div class="bar-fill" style="width: ${pct}%"></div>
                </div>
                <span class="bar-value">${AnalyticsService.formatDuration(mins)}</span>
              </div>
            `;
    }).join('')}
        </div>
      ` : '<div class="empty-state">No activity this week</div>'}
    </div>

    <!-- Heatmap -->
    <div class="card" style="grid-column: 1 / -1;">
      <h2>Activity Heatmap (Last 7 Days)</h2>
      <div class="heatmap">
        <div></div>
        ${orderedDays.map(d => `<div class="heatmap-header">${d}</div>`).join('')}
        ${[6, 8, 10, 12, 14, 16, 18, 20, 22].map(hour => `
          <div class="heatmap-hour">${hour}:00</div>
          ${heatmap.map((dayData, _dayIdx) => {
      const value = dayData[hour] ?? 0;
      const level = Math.min(5, Math.ceil((value / maxHeatmapValue) * 5));
      return `<div class="heatmap-cell level-${level}" title="${value}m"></div>`;
    }).join('')}
        `).join('')}
      </div>
    </div>
  </div>
</body>
</html>`;
  }

  /**
   * Dispose the panel
   */
  dispose(): void {
    this.panel?.dispose();
    this.panel = null;
  }
}

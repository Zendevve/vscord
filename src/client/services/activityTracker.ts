/**
 * Activity Tracker Service
 * Monitors VS Code activity and sends updates
 */

import * as vscode from 'vscode';
import type { StatusType, ActivityType } from '../../shared/types';
import { AWAY_TIMEOUT_MS, UPDATE_DEBOUNCE_MS } from '../../shared/types';

export interface ActivityState {
  status: StatusType;
  activity: ActivityType;
  project: string;
  language: string;
}

export class ActivityTracker {
  private currentState: ActivityState = {
    status: 'Online',
    activity: 'Idle',
    project: '',
    language: '',
  };

  private lastActivityTime = Date.now();
  private updateTimer: NodeJS.Timeout | null = null;
  private awayTimer: NodeJS.Timeout | null = null;
  private disposables: vscode.Disposable[] = [];
  private onUpdate: (state: ActivityState) => void;

  constructor(onUpdate: (state: ActivityState) => void) {
    this.onUpdate = onUpdate;
  }

  /**
   * Start tracking activity
   */
  start(): void {
    // Track document changes
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(() => {
        this.recordActivity('Coding');
      })
    );

    // Track active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.recordActivity('Reading');
          this.updateFromEditor(editor);
        }
      })
    );

    // Track debug sessions
    this.disposables.push(
      vscode.debug.onDidStartDebugSession(() => {
        this.recordActivity('Debugging');
      })
    );

    this.disposables.push(
      vscode.debug.onDidTerminateDebugSession(() => {
        this.recordActivity('Coding');
      })
    );

    // Track window focus
    this.disposables.push(
      vscode.window.onDidChangeWindowState((state) => {
        if (!state.focused) {
          this.checkAway();
        } else {
          this.recordActivity(this.currentState.activity);
        }
      })
    );

    // Initial state
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.updateFromEditor(editor);
    }

    // Start away timer
    this.startAwayTimer();
  }

  /**
   * Record activity and schedule update
   */
  private recordActivity(activity: ActivityType): void {
    this.lastActivityTime = Date.now();

    // Clear away status
    if (this.currentState.status === 'Away') {
      this.currentState.status = 'Online';
    }

    const changed = this.currentState.activity !== activity;
    this.currentState.activity = activity;

    if (changed) {
      this.scheduleUpdate();
    }

    this.startAwayTimer();
  }

  /**
   * Update from active editor
   */
  private updateFromEditor(editor: vscode.TextEditor): void {
    const doc = editor.document;

    // Get project name from workspace
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(doc.uri);
    const project = workspaceFolder?.name ?? '';

    // Get language
    const language = doc.languageId;

    const changed =
      this.currentState.project !== project ||
      this.currentState.language !== language;

    this.currentState.project = project;
    this.currentState.language = language;

    if (changed) {
      this.scheduleUpdate();
    }
  }

  /**
   * Check if should go away
   */
  private checkAway(): void {
    const elapsed = Date.now() - this.lastActivityTime;
    if (elapsed >= AWAY_TIMEOUT_MS) {
      if (this.currentState.status !== 'Away') {
        this.currentState.status = 'Away';
        this.currentState.activity = 'Idle';
        this.scheduleUpdate();
      }
    }
  }

  /**
   * Start away timer
   */
  private startAwayTimer(): void {
    if (this.awayTimer) {
      clearTimeout(this.awayTimer);
    }
    this.awayTimer = setTimeout(() => {
      this.checkAway();
    }, AWAY_TIMEOUT_MS);
  }

  /**
   * Schedule debounced update
   */
  private scheduleUpdate(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
    }
    this.updateTimer = setTimeout(() => {
      this.onUpdate({ ...this.currentState });
    }, UPDATE_DEBOUNCE_MS);
  }

  /**
   * Get current state
   */
  getState(): ActivityState {
    return { ...this.currentState };
  }

  /**
   * Stop tracking
   */
  dispose(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (this.awayTimer) clearTimeout(this.awayTimer);
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

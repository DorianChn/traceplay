import type { TestReport } from '../types.js';

export function formatJson(report: TestReport): string {
  return JSON.stringify(report, null, 2);
}

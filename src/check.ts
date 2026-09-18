import { safeError } from './config.js';
import type { Decision } from './jev.js';

export interface Subject { name: string; content?: string; error?: string }
export interface SubjectResult {
  name: string;
  status: 'passed' | 'condition-false' | 'low-confidence' | 'error';
  confidence: number | null;
  error?: string;
}
export interface CheckResult {
  result: boolean;
  confidence: number;
  status: 'passed' | 'failed' | 'error';
  subjects: SubjectResult[];
}

export async function checkSubjects(
  subjects: Subject[], minConfidence: number, judge: (content: string) => Promise<Decision>, concurrency = 4,
): Promise<CheckResult> {
  const results: SubjectResult[] = new Array(subjects.length);
  let next = 0;
  async function worker() {
    while (next < subjects.length) {
      const index = next++;
      const subject = subjects[index]!;
      try {
        if (subject.error || !subject.content?.trim()) {
          results[index] = { name: subject.name, status: 'error', confidence: null, error: subject.error || 'No content to evaluate.' };
          continue;
        }
        const answer = await judge(subject.content);
        const status = answer.confidence < minConfidence ? 'low-confidence' : answer.value ? 'passed' : 'condition-false';
        results[index] = { name: subject.name, status, confidence: answer.confidence };
      } catch (error) {
        results[index] = { name: subject.name, status: 'error', confidence: null, error: safeError(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, subjects.length) }, worker));
  const hasError = results.some(r => r.status === 'error') || results.length === 0;
  const passed = !hasError && results.every(r => r.status === 'passed');
  return {
    result: passed,
    confidence: hasError ? 0 : Math.min(...results.map(r => r.confidence!)),
    status: hasError ? 'error' : passed ? 'passed' : 'failed',
    subjects: results,
  };
}

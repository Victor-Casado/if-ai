import type { CheckResult } from './check.js';

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function summary(result: CheckResult, mode: string, minConfidence: number): string {
  const rows = result.subjects.map(s => '<tr><td><code>' + escapeHtml(s.name) + '</code></td><td>' +
    s.status + '</td><td>' + (s.confidence === null ? 'Unavailable' : String(s.confidence)) + '</td><td>' +
    escapeHtml(s.error || '') + '</td></tr>').join('\n');
  return `<h2>if-ai: ${result.status}</h2>\n<p>Mode: ${escapeHtml(mode)}. Minimum confidence: ${minConfidence}. Every subject must pass.</p>\n` +
    '<table><thead><tr><th>Subject</th><th>Result</th><th>Confidence</th><th>Details</th></tr></thead><tbody>\n' + rows + '\n</tbody></table>\n' +
    '<p>Confidence describes model certainty, not measured accuracy. In per-file mode the aggregate is the minimum file confidence, not a joint probability. An error makes aggregate confidence 0.</p>\n';
}

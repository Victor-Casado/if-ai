import type { CheckResult } from './check.js';

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
}

export function skippedSummary(mode: string, paths: string[]): string {
  return [
    '<h2>if-ai: skipped</h2>',
    `<p>Mode: ${escapeHtml(mode)}. No changed file matched the configured paths, so the condition does not apply to this pull request and Jev was not called.</p>`,
    '<p>Paths:</p>',
    `<ul>${paths.map((path) => `<li><code>${escapeHtml(path)}</code></li>`).join('')}</ul>`,
    '',
  ].join('\n');
}

export function summary(result: CheckResult, mode: string, minConfidence: number): string {
  const rows = result.subjects
    .map((subject) => {
      const confidence = subject.confidence === null ? 'Unavailable' : String(subject.confidence);
      return `<tr>
<td><code>${escapeHtml(subject.name)}</code></td>
<td>${subject.status}</td>
<td>${confidence}</td>
<td>${escapeHtml(subject.error || '')}</td>
</tr>`;
    })
    .join('\n');
  return [
    `<h2>if-ai: ${result.status}</h2>`,
    `<p>Mode: ${escapeHtml(mode)}. Minimum confidence: ${minConfidence}. Every subject must pass.</p>`,
    '<table><thead><tr><th>Subject</th><th>Result</th><th>Confidence</th><th>Details</th></tr></thead>',
    `<tbody>${rows}</tbody></table>`,
    '<p>Confidence describes model certainty, not measured accuracy. In per-file mode it is the minimum file confidence. An error makes aggregate confidence 0.</p>',
    '',
  ].join('\n');
}

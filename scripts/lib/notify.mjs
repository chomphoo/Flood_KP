// Push notifications via ntfy.sh (free, no account). Anyone can subscribe to the topic in the ntfy app.
// Sent only for new/escalated conditions with severity >= 2, merged into one message per run.
import { CONFIG } from './config.mjs';

const SEV_LABEL = { 1: 'เฝ้าระวัง', 2: 'เตือนภัย', 3: 'อันตราย' };

/** Pick timeline events worth a push (pure – unit-tested). */
export function pickNotifiable(events, minSev = 2, max = 5) {
  return events
    .filter((e) => (e.change === 'new' || e.change === 'up') && e.sev >= minSev)
    .sort((a, b) => b.sev - a.sev)
    .slice(0, max);
}

/** Build the ntfy JSON payload (pure – unit-tested). Returns null when nothing to send. */
export function buildNtfyMessage(events, { topic, siteUrl, total = events.length } = {}) {
  if (!events.length || !topic) return null;
  const top = Math.max(...events.map((e) => e.sev));
  const lines = events.map((e) => `• [${SEV_LABEL[e.sev] || ''}] ${e.title}${e.change === 'up' ? ' (ระดับสูงขึ้น)' : ''}`);
  if (total > events.length) lines.push(`…และอีก ${total - events.length} รายการ`);
  return {
    topic,
    title: `น้ำท่วมกำแพงเพชร: ${SEV_LABEL[top]} ${events.length} รายการใหม่`,
    message: lines.join('\n'),
    priority: top >= 3 ? 4 : 3,
    tags: [top >= 3 ? 'rotating_light' : 'warning', 'ocean'],
    click: siteUrl,
  };
}

export async function notifyNtfy(events) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return { sent: false, reason: 'NTFY_TOPIC not set' };
  const all = events.filter((e) => (e.change === 'new' || e.change === 'up') && e.sev >= 2);
  const picked = pickNotifiable(events);
  const body = buildNtfyMessage(picked, { topic, siteUrl: CONFIG.siteUrl, total: all.length });
  if (!body) return { sent: false, reason: 'nothing new' };
  try {
    const res = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { sent: res.ok, status: res.status, count: picked.length };
  } catch (e) {
    return { sent: false, reason: e.message };
  }
}

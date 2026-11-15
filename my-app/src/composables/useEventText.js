/**
 * useEventText.js — turns an event_log row into something displayable.
 *
 * ONE implementation, used by both the dashboard insights panel and the
 * Events view. If each built its own sentence they would drift, and a row
 * would read differently depending on where you looked at it.
 *
 * Localisation
 *   New rows carry a render payload in `metadata` and render from
 *   `events.messages.<category>.<event>`.
 *
 *   Note the `.messages.` segment: `events.*` is already the Events VIEW's
 *   chrome (title, colTime, colAction...). Putting row templates directly
 *   under `events.` would mix UI labels and content in one namespace, so
 *   they live one level down.
 *
 *   Rows written before keying — several hundred of them — only carry an
 *   English `message` and cannot be retranslated. So: use the key when it
 *   exists, fall back to `message`.
 *
 *   A KEY MUST NOT BE ADDED UNLESS metadata CAN SATISFY IT. A template whose
 *   placeholders are missing still "exists", so it wins over the stored
 *   message and renders with holes — "{name} unreachable" with no name became
 *   " unreachable", replacing a message that named the module, the failure
 *   count and the retry interval. Worse than no key at all.
 *
 *   Two defences: params are enriched with row-level fields below, and an
 *   empty or suspiciously short render falls back to `message`.
 *
 * Conditions vs moments
 *   `resolved_at === null` means the condition is STILL TRUE. That has to
 *   look different from something that finished, or an ongoing state reads
 *   as history.
 */

import { computed } from 'vue';
import { useLocale } from './useLocale';

export function useEventText() {
  const locale = useLocale();
  const { t } = locale;

  /**
   * vue-i18n's te() is the clean existence check, but useLocale may not
   * expose it. Falling back on the standard trick: an untranslated key
   * renders as itself.
   */
  const hasKey = (key) => {
    if (typeof locale.te === 'function') return locale.te(key);
    return t(key) !== key;
  };

  /**
   * Params available to a template: the row's metadata plus fields every row
   * carries. `sourceName` strips the `kind:` prefix, so a template can name
   * its origin without the call site having to put it in metadata.
   */
  function paramsFor(row) {
    const source = row.source || '';
    return {
      ...(row.metadata || {}),
      source,
      sourceName: source.includes(':') ? source.split(':').slice(1).join(':') : source,
      category: row.category,
      event: row.event,
    };
  }

  /** Localised sentence for one row. */
  function eventText(row) {
    if (!row) return '';
    const fallback = row.message || row.event || '';
    const key = `events.messages.${row.category}.${row.event}`;
    if (!hasKey(key)) return fallback;

    const rendered = t(key, paramsFor(row));

    // A template with unmet placeholders renders short or empty. The stored
    // message carries real detail, so it wins over a hollow translation.
    if (!rendered || !rendered.trim()) return fallback;
    if (fallback && rendered.trim().length < 4) return fallback;

    return rendered;
  }

  /** Localised category label, falling back to the raw value. */
  function categoryLabel(category) {
    const key = `events.categories.${category}`;
    return hasKey(key) ? t(key) : category;
  }

  /**
   * The number a condition card shows.
   *
   * Precedence, so a module can opt in without this file learning every event
   * type: an explicit displayValue wins, then the common physical quantities,
   * then the repeat count. A condition with none of these gets no number —
   * "Battery full" needs none.
   */
  function eventValue(row) {
    const m = row.metadata || {};

    if (m.displayValue !== undefined && m.displayValue !== null) {
      return { value: String(m.displayValue), unit: m.displayUnit || '' };
    }
    if (Number.isFinite(m.watts)) {
      const kw = m.watts / 1000;
      return { value: kw.toFixed(kw < 10 ? 2 : 1), unit: 'kW' };
    }
    if (Number.isFinite(m.soc))   return { value: String(Math.round(m.soc)), unit: '%' };
    if (Number.isFinite(m.pct))   return { value: String(Math.round(m.pct)), unit: '%' };
    if (Number.isFinite(m.floor)) return { value: String(Math.round(m.floor)), unit: '%' };
    if (Number.isFinite(m.kwh))   return { value: m.kwh.toFixed(1), unit: 'kWh' };

    const n = m.occurrences ?? 1;
    if (n > 1) return { value: String(n), unit: '×' };

    return { value: null, unit: '' };
  }

  /**
   * Short label for a condition card — the sentence is often too long for a
   * 260px card, so the card leads with the event name and keeps the full
   * sentence as a title attribute.
   */
  function shortLabel(row) {
    const key = `events.short.${row.category}.${row.event}`;
    if (hasKey(key)) return t(key, paramsFor(row));
    // Fall back to the event name, humanised: soc_full -> Soc full
    const words = String(row.event || '').replace(/_/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  /**
   * Row -> view model.
   * Timestamps are 'YYYY-MM-DD HH:MM:SS' local — sliced, never re-parsed as
   * a Date, which would reintroduce a UTC shift.
   */
  function toView(row) {
    return {
      id: row.id,
      time: String(row.timestamp || '').slice(11, 16),
      date: String(row.timestamp || '').slice(0, 10),
      text: eventText(row),
      category: row.category,
      categoryLabel: categoryLabel(row.category),
      severity: row.severity,
      ongoing: row.resolved_at === null || row.resolved_at === undefined,
      occurrences: row.metadata?.occurrences ?? 1,
      shortLabel: shortLabel(row),
      ...eventValue(row),
      since: sinceLabel(row.timestamp),
    };
  }

  /**
   * "since 09:12" for today, "since Tue 03:09" for earlier. The row's
   * timestamp is when the condition STARTED — dedupe keeps the original — so
   * this is genuinely how long it has been true.
   */
  function sinceLabel(ts) {
    const str = String(ts || '');
    const date = str.slice(0, 10);
    const time = str.slice(11, 16);
    if (!time) return '';

    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
    if (date === today) return time;

    // Parsed only for the weekday name; the displayed time stays the string.
    const d = new Date(`${date}T00:00:00`);
    const day = Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { weekday: 'short' });
    return `${day} ${time}`;
  }

  const toViews = (rows) => (rows || []).map(toView);

  return { eventText, categoryLabel, eventValue, shortLabel, toView, toViews };
}

/** Standalone mapper for places that already hold a `t`. */
export function makeEventText(t, te = null) {
  const hasKey = (k) => (typeof te === 'function' ? te(k) : t(k) !== k);
  return (row) => {
    const key = `events.messages.${row.category}.${row.event}`;
    return hasKey(key) ? t(key, row.metadata || {}) : (row.message || row.event);
  };
}

export default useEventText;
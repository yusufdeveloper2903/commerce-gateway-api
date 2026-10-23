/**
 * Minimal Prometheus text-format (v0.0.4) registry: counters, gauges and
 * histograms with labels. Hand-rolled to keep the dependency surface small;
 * swapping in prom-client later only touches this file.
 */
type Labels = Record<string, string | number>;

function labelKey(labels: Labels): string {
  return Object.keys(labels)
    .sort()
    .map(
      (k) =>
        `${k}="${String(labels[k]).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`,
    )
    .join(',');
}

function fmt(name: string, key: string, value: number): string {
  return `${name}${key ? `{${key}}` : ''} ${value}`;
}

interface Metric {
  render(): string;
}

abstract class BaseMetric implements Metric {
  constructor(
    readonly name: string,
    readonly help: string,
    readonly kind: 'counter' | 'gauge' | 'histogram',
  ) {}

  protected header(): string {
    return `# HELP ${this.name} ${this.help}\n# TYPE ${this.name} ${this.kind}`;
  }

  abstract render(): string;
}

export class Counter extends BaseMetric {
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    super(name, help, 'counter');
  }

  inc(labels: Labels = {}, by = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + by);
  }

  get(labels: Labels = {}): number {
    return this.values.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines = [...this.values].map(([k, v]) => fmt(this.name, k, v));
    return [this.header(), ...lines].join('\n');
  }
}

export class Gauge extends BaseMetric {
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string) {
    super(name, help, 'gauge');
  }

  set(value: number, labels: Labels = {}): void {
    this.values.set(labelKey(labels), value);
  }

  render(): string {
    const lines = [...this.values].map(([k, v]) => fmt(this.name, k, v));
    return [this.header(), ...lines].join('\n');
  }
}

interface HistogramSeries {
  buckets: number[];
  sum: number;
  count: number;
}

export class Histogram extends BaseMetric {
  private readonly series = new Map<string, HistogramSeries>();

  constructor(
    name: string,
    help: string,
    private readonly bounds: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  ) {
    super(name, help, 'histogram');
  }

  observe(value: number, labels: Labels = {}): void {
    const key = labelKey(labels);
    let s = this.series.get(key);
    if (!s) {
      s = { buckets: this.bounds.map(() => 0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    this.bounds.forEach((bound, i) => {
      if (value <= bound) s.buckets[i] = (s.buckets[i] ?? 0) + 1;
    });
    s.sum += value;
    s.count++;
  }

  render(): string {
    const lines: string[] = [this.header()];
    for (const [key, s] of this.series) {
      const prefix = key ? `${key},` : '';
      this.bounds.forEach((bound, i) => {
        lines.push(`${this.name}_bucket{${prefix}le="${bound}"} ${s.buckets[i] ?? 0}`);
      });
      lines.push(`${this.name}_bucket{${prefix}le="+Inf"} ${s.count}`);
      lines.push(fmt(`${this.name}_sum`, key, s.sum));
      lines.push(fmt(`${this.name}_count`, key, s.count));
    }
    return lines.join('\n');
  }
}

export class MetricsRegistry {
  private readonly metrics: Metric[] = [];

  readonly httpRequestsTotal = this.register(
    new Counter('http_requests_total', 'Total HTTP requests handled by the gateway'),
  );
  readonly httpRequestDuration = this.register(
    new Histogram('http_request_duration_seconds', 'Gateway HTTP request latency in seconds'),
  );
  readonly upstreamRequestsTotal = this.register(
    new Counter('upstream_requests_total', 'Upstream requests by outcome'),
  );
  readonly upstreamRequestDuration = this.register(
    new Histogram('upstream_request_duration_seconds', 'Upstream request latency in seconds'),
  );
  readonly upstreamRetriesTotal = this.register(
    new Counter('upstream_retries_total', 'Upstream retry attempts'),
  );
  readonly cacheEventsTotal = this.register(
    new Counter('cache_events_total', 'Cache lookups by result (HIT, MISS, COALESCED)'),
  );
  readonly circuitBreakerState = this.register(
    new Gauge('circuit_breaker_state', 'Circuit breaker state (0=closed, 1=half-open, 2=open)'),
  );

  register<M extends Metric>(metric: M): M {
    this.metrics.push(metric);
    return metric;
  }

  render(): string {
    const mem = process.memoryUsage();
    const runtime = [
      '# HELP process_resident_memory_bytes Resident memory size in bytes',
      '# TYPE process_resident_memory_bytes gauge',
      `process_resident_memory_bytes ${mem.rss}`,
      '# HELP process_uptime_seconds Process uptime in seconds',
      '# TYPE process_uptime_seconds gauge',
      `process_uptime_seconds ${process.uptime()}`,
    ].join('\n');
    return [...this.metrics.map((m) => m.render()), runtime].join('\n') + '\n';
  }
}

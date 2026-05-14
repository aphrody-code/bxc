# Bunlight storage: Dataset

`Dataset` is Bunlight's append-only JSONL writer. Use it when you want one record per line, streamable to disk, with no schema overhead. Internally it uses `Bun.file().writer()` so writes are buffered and flushed on close.

## Quick start

```ts
import { Dataset } from "@bunmium/bunlight/storage";

const ds = new Dataset("data.jsonl");
await ds.pushData({ url: "https://example.com", title: "Example", price: 9.99 });
await ds.pushData({ url: "https://example.com/2", title: "Other", price: 4.99 });
await ds.close();
```

Output (`data.jsonl`):

```
{"url":"https://example.com","title":"Example","price":9.99}
{"url":"https://example.com/2","title":"Other","price":4.99}
```

## API

### `new Dataset(path: string, opts?: DatasetOptions)`

Opens or creates the file. If it exists, new records append.

`DatasetOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `flushEvery` | `number` | `100` | Flush after N records. |
| `format` | `"jsonl" \| "json"` | `"jsonl"` | `"json"` writes one big array (less common). |

### `pushData(record)`

Appends a record. The record is JSON-stringified once, no whitespace, then a newline.

### `pushDataMany(records[])`

Bulk append. Use for batches; cheaper than N calls to `pushData`.

### `close()`

Flushes and closes the underlying writer. Always call this in `finally` to avoid losing the last buffered records.

### `path: string`

The file path the dataset writes to. Read-only.

## Streaming reads

For big datasets, read line by line:

```ts
const reader = Bun.file("data.jsonl").stream().getReader();
const decoder = new TextDecoder();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line) {
      const record = JSON.parse(line);
      // process record
    }
  }
}
```

## Patterns

### Append during a crawl

```ts
import { Dataset } from "@bunmium/bunlight/storage";
import { PagePool } from "@bunmium/bunlight/pool/PagePool";

const ds = new Dataset("crawl.jsonl");
const pool = new PagePool({ profile: "fast", concurrency: 50 });

try {
  await pool.run(urls, async (page, url) => {
    await page.goto(url);
    const title = await page.title();
    await ds.pushData({ url, title });
  });
} finally {
  await pool.close();
  await ds.close();
}
```

### Convert to CSV

```ts
const lines: string[] = [];
const reader = Bun.file("data.jsonl").stream().getReader();
// ... read each record ...
lines.push(`${record.url},${JSON.stringify(record.title)},${record.price}`);
await Bun.write("data.csv", "url,title,price\n" + lines.join("\n"));
```

### Multiple datasets per crawl

Split by category to keep files small:

```ts
const datasets = new Map<string, Dataset>();
function dsFor(category: string) {
  if (!datasets.has(category)) {
    datasets.set(category, new Dataset(`data/${category}.jsonl`));
  }
  return datasets.get(category)!;
}

// At end:
for (const ds of datasets.values()) {
  await ds.close();
}
```

## Constraints

- JSONL is append-only. Mutations require rewriting the file.
- One writer per file at a time. Concurrent `Dataset` instances pointing at the same path will interleave bytes.
- Records must be JSON-serializable. `BigInt`, `Date`, and circular refs throw.
- The file mode follows process umask; `chmod 600` it manually if it contains sensitive data.

## See also

- `references/cookbook.md` recipe #9 for the full export-to-JSONL example.
- `references/queue.md` for `RequestQueue` (different file, different purpose: queue state vs result data).
- `references/pool.md` for `PagePool` patterns that pair naturally with `Dataset`.

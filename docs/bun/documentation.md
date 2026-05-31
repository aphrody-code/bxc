# Bun Native API Documentation

This document compiles the official APIs, specifications, and code patterns for the Bun runtime as of 2026. Bun is an all-in-one JavaScript/TypeScript runtime, bundler, test runner, and package manager designed for high performance.

---

## 1. Core File I/O APIs

Bun offers highly optimized, native file system APIs that outperform standard Node.js `fs` operations.

### Reading Files (`Bun.file`)
`Bun.file()` returns a `BunFile` object representing a file. It does not load the file into memory until requested.
```ts
// Get a reference to a file
const file = Bun.file("data.json");

// Read file contents as text
const text = await file.text();

// Read file contents as JSON
const data = await file.json();

// Read file contents as ArrayBuffer
const buffer = await file.arrayBuffer();

// Read file contents as Uint8Array
const uint8 = await file.bytes();

// Read file contents as a ReadableStream
const stream = file.stream();
```

### Writing Files (`Bun.write`)
`Bun.write()` writes data to a file. It accepts strings, Blobs, ArrayBuffers, TypedArrays, Response objects, or ReadableStreams.
```ts
// Write a simple string to a file
await Bun.write("output.txt", "Hello, Bun!");

// Write a JSON object
const payload = { timestamp: new Date().toISOString(), status: "ok" };
await Bun.write("status.json", JSON.stringify(payload, null, 2));

// Copying a file (using a BunFile as input)
const source = Bun.file("source.txt");
await Bun.write("destination.txt", source);
```

### Standard Streams
Access standard I/O streams using native references:
- `Bun.stdin`: Standard input stream.
- `Bun.stdout`: Standard output stream.
- `Bun.stderr`: Standard error stream.

---

## 2. HTTP Server & WebSockets (`Bun.serve`)

`Bun.serve` is Bun's built-in fast HTTP server. It supports routing, WebSockets, SSL, and error handling.

### Simple HTTP Server
```ts
const server = Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response("Welcome to bxc server!");
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server listening on http://localhost:${server.port}`);
```

### Routes-Based HTTP Server
Bun supports native declarative routing mapping paths directly:
```ts
Bun.serve({
  routes: {
    "/api/status": () => Response.json({ status: "alive" }),
    "/api/users/:id": (req) => {
      const id = req.params.id;
      return Response.json({ id, name: `User ${id}` });
    },
  },
  error(error) {
    console.error("HTTP Server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});
```

### WebSocket Server
Upgrade incoming HTTP requests to WebSocket connections natively:
```ts
const server = Bun.serve({
  port: 3000,
  fetch(req, server) {
    // Attempt to upgrade request to a WebSocket connection
    const upgraded = server.upgrade(req, {
      data: {
        authToken: req.headers.get("Authorization") || "anonymous",
      },
    });
    if (upgraded) {
      // The upgrade succeeds; Bun handles the 101 Switching Protocols
      return undefined;
    }
    return new Response("Standard HTTP response");
  },
  websocket: {
    // ws.data has type of the data object passed to server.upgrade
    open(ws) {
      console.log(`WebSocket opened. Token: ${ws.data.authToken}`);
    },
    message(ws, message) {
      console.log(`Received message: ${message}`);
      ws.send(`Echo: ${message}`);
    },
    close(ws, code, reason) {
      console.log(`WebSocket closed: ${code} - ${reason}`);
    },
  },
});
```

---

## 3. Database Integrations

Bun comes with a native high-performance SQLite driver that is far faster than `better-sqlite3`.

### Native SQLite Driver (`bun:sqlite`)
```ts
import { Database } from "bun:sqlite";

// Open/create a file-based database or in-memory database
const db = new Database("bxc-memory.sqlite");

// Execute raw SQL statements (for schema setup)
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rating INTEGER,
    position TEXT
  )
`);

// Run parameterized queries using prepare statements
const insert = db.prepare("INSERT INTO players (id, name, rating, position) VALUES ($id, $name, $rating, $position)");
insert.run({
  $id: "170890",
  $name: "Blaise Matuidi",
  $rating: 85,
  $position: "CM"
});

// Retrieve all results
const players = db.query("SELECT * FROM players").all();
console.log(players);

// Retrieve a single result
const matuidi = db.query("SELECT * FROM players WHERE id = ?").get("170890");
console.log(matuidi);
```

### The `Bun.SQL` Interface
A modern template-literal tagging style for SQL queries.
```ts
import { SQL } from "bun";

// Initialize SQL client
const sql = new SQL("sqlite://bxc-memory.sqlite");

// Query with template strings safely escaped automatically
const rating = 80;
const topPlayers = await sql`SELECT * FROM players WHERE rating >= ${rating}`;
console.log(topPlayers);
```

---

## 4. Native DNS Module (`Bun.dns`)

Use Bun's high-performance DNS module to perform domain name resolutions without spawning external tools.

### Hostname Resolution
```ts
// Resolves a hostname to its IP addresses
try {
  const result = await Bun.dns.lookup("www.fut.gg");
  // Returns array of lookups: [{ address: "104.21.8.84", family: 4 }]
  console.log(`Resolved IP: ${result[0]?.address}`);
} catch (err) {
  console.error("DNS lookup failed:", err);
}
```

---

## 5. Non-Cryptographic Hashing (`Bun.hash`)

Bun includes native implementations of several extremely fast hashing algorithms. Great for visited-checks and caches.

### Available Hashing Algorithms
All algorithms share a consistent signature: `(data: string | ArrayBufferView, seed?: number | bigint) => number | bigint`.
```ts
// wyhash (Default Bun.hash implementation)
const hash1 = Bun.hash("hello");
const hash2 = Bun.hash.wyhash("hello", 1234);

// Additional algorithms
const crc = Bun.hash.crc32("hello");
const adler = Bun.hash.adler32("hello");
const city32 = Bun.hash.cityHash32("hello");
const city64 = Bun.hash.cityHash64("hello");
const xx32 = Bun.hash.xxHash32("hello");
const xx64 = Bun.hash.xxHash64("hello");
const xx3 = Bun.hash.xxHash3("hello");
const rapid = Bun.hash.rapidhash("hello");
```

---

## 6. Cryptographic Password Hashing (`Bun.password`)

Native APIs for password hashing using Argon2 (default) and bcrypt.

```ts
const password = "super-secure-password";

// Hash a password asynchronously
const hash = await Bun.password.hash(password);
// => "$argon2id$v=19$m=65536,t=2,p=1$..."

// Verify a password against a hash
const isMatch = await Bun.password.verify(password, hash);
// => true
```

---

## 7. DOM Parsing and Transformation (`HTMLRewriter`)

`HTMLRewriter` is a fast streaming HTML parser based on Cloudflare's `lol-html`. It allows parsing or modifying HTML elements without loading the whole DOM in memory.

### Extracting Links
```ts
async function extractLinks(htmlContent: string) {
  const links = new Set<string>();
  const rewriter = new HTMLRewriter().on("a[href]", {
    element(el) {
      const href = el.getAttribute("href");
      if (href) {
        links.add(href);
      }
    },
  });

  const response = new Response(htmlContent);
  await rewriter.transform(response).text();
  return [...links];
}
```

### Modifying Element Content
```ts
const rewriter = new HTMLRewriter().on("h1", {
  element(el) {
    el.setInnerContent("Updated Heading Title!");
  },
});

const originalHtml = "<html><body><h1>Original</h1></body></html>";
const response = new Response(originalHtml);
const updatedHtml = await rewriter.transform(response).text();
// => "<html><body><h1>Updated Heading Title!</h1></body></html>"
```

---

## 8. Process Spawning (`Bun.spawn` / `Bun.spawnSync`)

Manage subprocesses natively.

```ts
// Asynchronous process spawn
const proc = Bun.spawn(["ls", "-l"], {
  cwd: "/home/ubuntu",
  onExit(subprocess, exitCode, signalCode, error) {
    console.log(`Process exited with code ${exitCode}`);
  },
});

// Read standard output of child process
const stdout = await new Response(proc.stdout).text();
console.log(stdout);

// Synchronous process spawn (blocking)
const result = Bun.spawnSync(["echo", "hello from Bxc"]);
console.log(result.stdout.toString()); // => "hello from Bxc\n"
```

---

## 9. File Globbing (`Bun.Glob`)

Bun provides a highly optimized glob engine to scan directories matching pattern sets.

```ts
import { Glob } from "bun";

// Find all TypeScript files recursively in the project
const glob = new Glob("**/*.ts");

// Scan a directory asynchronously
for await (const file of glob.scan({ cwd: "./src" })) {
  console.log(`Found: ${file}`);
}
```

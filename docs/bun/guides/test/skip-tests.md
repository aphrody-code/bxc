> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Skip tests with the Bun test runner

To skip a test with the Bun test runner, use the `test.skip` function.

```ts test.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
import { test } from "bun:test";

test.skip("unimplemented feature", () => {
  expect(Bun.isAwesome()).toBe(true);
});
```

***

Running `bun test` will not execute this test. It will be marked as skipped in the terminal output.

```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
bun test
```

```txt theme={"theme":{"light":"github-light","dark":"dracula"}}
test.test.ts:
✓ add [0.03ms]
✓ multiply [0.02ms]
» unimplemented feature

 2 pass
 1 skip
 0 fail
 2 expect() calls
Ran 3 tests across 1 files. [74.00ms]
```

***

See also:

* [Mark a test as a todo](/guides/test/todo-tests)
* [Docs > Test runner > Writing tests](/test/writing-tests)

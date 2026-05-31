> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Check if two objects are deeply equal

Check if two objects are deeply equal. This is used internally by `expect().toEqual()` in Bun's [test runner](/test/writing-tests).

```ts index.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
const a = { a: 1, b: 2, c: { d: 3 } };
const b = { a: 1, b: 2, c: { d: 3 } };

Bun.deepEquals(a, b); // true
```

***

Pass `true` as a third argument to enable strict mode. This is used internally by `expect().toStrictEqual()` in Bun's [test runner](/test/writing-tests).

The following examples would return `true` in non-strict mode but `false` in strict mode.

```ts index.ts icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/typescript.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=7ac549adaea8d5487d8fbd58cc3ea35b" theme={"theme":{"light":"github-light","dark":"dracula"}}
// undefined values
Bun.deepEquals({}, { a: undefined }, true); // false

// undefined in arrays
Bun.deepEquals(["asdf"], ["asdf", undefined], true); // false

// sparse arrays
Bun.deepEquals([, 1], [undefined, 1], true); // false

// object literals vs instances w/ same properties
class Foo {
  a = 1;
}
Bun.deepEquals(new Foo(), { a: 1 }, true); // false
```

***

See [Docs > API > Utils](/runtime/utils) for more useful utilities.

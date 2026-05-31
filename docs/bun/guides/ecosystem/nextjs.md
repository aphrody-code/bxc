> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Build an app with Next.js and Bun

[Next.js](https://nextjs.org/) is a React framework for building full-stack web applications. It supports server-side rendering, static site generation, API routes, and more. Bun provides fast package installation and can run Next.js development and production servers.

***

<Steps>
  <Step title="Create a new Next.js app">
    Use the interactive CLI to create a new Next.js app. This will scaffold a new Next.js project and automatically install dependencies.

    ```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    bun create next-app@latest my-bun-app
    ```
  </Step>

  <Step title="Start the dev server">
    Change to the project directory and run the dev server with Bun.

    ```sh terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    cd my-bun-app
    bun --bun run dev
    ```

    This starts the Next.js dev server with Bun's runtime.

    Open [`http://localhost:3000`](http://localhost:3000) with your browser to see the result. Any changes you make to `app/page.tsx` will be hot-reloaded in the browser.
  </Step>

  <Step title="Update scripts in package.json">
    Modify the scripts field in your `package.json` by prefixing the Next.js CLI commands with `bun --bun`. This ensures that Bun executes the Next.js CLI for common tasks like `dev`, `build`, and `start`.

    ```json package.json icon="file-json" theme={"theme":{"light":"github-light","dark":"dracula"}}
    {
      "scripts": {
        "dev": "bun --bun next dev", // [!code ++]
        "build": "bun --bun next build", // [!code ++]
        "start": "bun --bun next start", // [!code ++]
      }
    }
    ```
  </Step>
</Steps>

***

## Hosting

Next.js applications on Bun can be deployed to various platforms.

<Columns cols={3}>
  <Card title="Vercel" href="/guides/deployment/vercel" icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/ecosystem/vercel.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=165bc9841eef2a62f3951be494dbc89a" width="24" height="24" data-path="icons/ecosystem/vercel.svg">
    Deploy on Vercel
  </Card>

  <Card title="Railway" href="/guides/deployment/railway" icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/ecosystem/railway.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=029a2b4b7c3a9f8dfab8d1bebbbfa054" width="24" height="24" data-path="icons/ecosystem/railway.svg">
    Deploy on Railway
  </Card>

  <Card title="DigitalOcean" href="/guides/deployment/digital-ocean" icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/ecosystem/digitalocean.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=aead95e8fef32d0ec83e63292f21f80c" width="24" height="24" data-path="icons/ecosystem/digitalocean.svg">
    Deploy on DigitalOcean
  </Card>

  <Card title="AWS Lambda" href="/guides/deployment/aws-lambda" icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/ecosystem/aws.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=f747e7b59435e87b2e379be04eabda8f" width="24" height="24" data-path="icons/ecosystem/aws.svg">
    Deploy on AWS Lambda
  </Card>

  <Card title="Google Cloud Run" href="/guides/deployment/google-cloud-run" icon="https://mintcdn.com/bun-1dd33a4e/cfVIaCNGtFU88Wgc/icons/ecosystem/gcp.svg?fit=max&auto=format&n=cfVIaCNGtFU88Wgc&q=85&s=a99e6cb0cfadfeb9ea3b6451de38cfd6" width="24" height="24" data-path="icons/ecosystem/gcp.svg">
    Deploy on Google Cloud Run
  </Card>

  <Card title="Render" href="/guides/deployment/render" icon="https://mintcdn.com/bun-1dd33a4e/JUhaF6Mf68z_zHyy/icons/ecosystem/render.svg?fit=max&auto=format&n=JUhaF6Mf68z_zHyy&q=85&s=b632a0b982a579fa5a2d0b96f33bace8" width="24" height="24" data-path="icons/ecosystem/render.svg">
    Deploy on Render
  </Card>
</Columns>

***

## Templates

<Columns cols={2}>
  <Card title="Bun + Next.js Basic Starter" img="https://mintcdn.com/bun-1dd33a4e/M5IN-LfyV8DoQVZm/images/templates/bun-nextjs-basic.png?fit=max&auto=format&n=M5IN-LfyV8DoQVZm&q=85&s=2bc9edb73c9c49d88e8ced9e2158f75a" href="https://github.com/bun-templates/bun-nextjs-basic" arrow="true" cta="Go to template" width="2212" height="1326" data-path="images/templates/bun-nextjs-basic.png">
    A simple App Router starter with Bun, Next.js, and Tailwind CSS.
  </Card>

  <Card title="Todo App with Next.js + Bun" img="https://mintcdn.com/bun-1dd33a4e/M5IN-LfyV8DoQVZm/images/templates/bun-nextjs-todo.png?fit=max&auto=format&n=M5IN-LfyV8DoQVZm&q=85&s=e8f398caf487c6b925a53025c42f4dab" href="https://github.com/bun-templates/bun-nextjs-todo" arrow="true" cta="Go to template" width="2212" height="1326" data-path="images/templates/bun-nextjs-todo.png">
    A full-stack todo application built with Bun, Next.js, and PostgreSQL.
  </Card>
</Columns>

***

[→ See Next.js's official documentation](https://nextjs.org/docs) for more information on building and deploying Next.js applications.

> ## Documentation Index
> Fetch the complete documentation index at: https://bun.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Deploy a Bun application on AWS Lambda

[AWS Lambda](https://aws.amazon.com/lambda/) is a serverless compute service that lets you run code without provisioning or managing servers.

In this guide, we will deploy a Bun HTTP server to AWS Lambda using a `Dockerfile`.

<Note>
  Before continuing, make sure you have:

  * A Bun application ready for deployment
  * An [AWS account](https://aws.amazon.com/)
  * [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html) installed and configured
  * [Docker](https://docs.docker.com/get-started/get-docker/) installed and added to your `PATH`
</Note>

***

<Steps>
  <Step title="Create a new Dockerfile">
    Make sure you're in the directory containing your project, then create a new `Dockerfile` in the root of your project. This file contains the instructions to initialize the container, copy your local project files into it, install dependencies, and start the application.

    ```docker Dockerfile icon="docker" theme={"theme":{"light":"github-light","dark":"dracula"}}
    # Use the official AWS Lambda adapter image to handle the Lambda runtime
    FROM public.ecr.aws/awsguru/aws-lambda-adapter:0.9.0 AS aws-lambda-adapter

    # Use the official Bun image to run the application
    FROM oven/bun:debian AS bun_latest

    # Copy the Lambda adapter into the container
    COPY --from=aws-lambda-adapter /lambda-adapter /opt/extensions/lambda-adapter

    # Set the port to 8080. This is required for the AWS Lambda adapter.
    ENV PORT=8080

    # Set the work directory to `/var/task`. This is the default work directory for Lambda.
    WORKDIR "/var/task"

    # Copy the package.json and bun.lock into the container
    COPY package.json bun.lock ./

    # Install the dependencies
    RUN bun install --production --frozen-lockfile

    # Copy the rest of the application into the container
    COPY . /var/task

    # Run the application.
    CMD ["bun", "index.ts"]
    ```

    <Note>
      Make sure that the start command corresponds to your application's entry point. This can also be `CMD ["bun", "run", "start"]` if you have a start script in your `package.json`.

      This image installs dependencies and runs your app with Bun inside a container. If your app doesn't have dependencies, you can omit the `RUN bun install --production --frozen-lockfile` line.
    </Note>

    Create a new `.dockerignore` file in the root of your project. This file contains the files and directories that should be *excluded* from the container image, such as `node_modules`. This makes your builds faster and smaller:

    ```docker .dockerignore icon="Docker" theme={"theme":{"light":"github-light","dark":"dracula"}}
    node_modules
    Dockerfile*
    .dockerignore
    .git
    .gitignore
    README.md
    LICENSE
    .vscode
    .env
    # Any other files or directories you want to exclude
    ```
  </Step>

  <Step title="Build the Docker image">
    Make sure you're in the directory containing your `Dockerfile`, then build the Docker image. In this case, we'll call the image `bun-lambda-demo` and tag it as `latest`.

    ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    # cd /path/to/your/app
    docker build --provenance=false --platform linux/amd64 -t bun-lambda-demo:latest .
    ```
  </Step>

  <Step title="Create an ECR repository">
    To push the image to AWS Lambda, we first need to create an [ECR repository](https://aws.amazon.com/ecr/) to push the image to.

    By running the following command, we:

    * Create an ECR repository named `bun-lambda-demo` in the `us-east-1` region
    * Get the repository URI, and export the repository URI as an environment variable. This is optional, but make the next steps easier.

    ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    export ECR_URI=$(aws ecr create-repository --repository-name bun-lambda-demo --region us-east-1 --query 'repository.repositoryUri' --output text)
    echo $ECR_URI
    ```

    ```txt theme={"theme":{"light":"github-light","dark":"dracula"}}
    [id].dkr.ecr.us-east-1.amazonaws.com/bun-lambda-demo
    ```

    <Note>
      If you're using IAM Identity Center (SSO) or have configured AWS CLI with profiles, you'll need to add the `--profile` flag to your AWS CLI commands.

      For example, if your profile is named `my-sso-app`, use `--profile my-sso-app`. Check your AWS CLI configuration with `aws configure list-profiles` to see available profiles.

      ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
      export ECR_URI=$(aws ecr create-repository --repository-name bun-lambda-demo --region us-east-1 --profile my-sso-app --query 'repository.repositoryUri' --output text)
      echo $ECR_URI
      ```
    </Note>
  </Step>

  <Step title="Authenticate with the ECR repository">
    Log in to the ECR repository:

    ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_URI
    ```

    ```txt theme={"theme":{"light":"github-light","dark":"dracula"}}
    Login Succeeded
    ```

    <Note>
      If using a profile, use the `--profile` flag:

      ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
      aws ecr get-login-password --region us-east-1 --profile my-sso-app | docker login --username AWS --password-stdin $ECR_URI
      ```
    </Note>
  </Step>

  <Step title="Tag and push the docker image to the ECR repository">
    Make sure you're in the directory containing your `Dockerfile`, then tag the docker image with the ECR repository URI.

    ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    docker tag bun-lambda-demo:latest ${ECR_URI}:latest
    ```

    Then, push the image to the ECR repository.

    ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    docker push ${ECR_URI}:latest
    ```
  </Step>

  <Step title="Create an AWS Lambda function">
    Go to **AWS Console** > **Lambda** > [**Create Function**](https://us-east-1.console.aws.amazon.com/lambda/home?region=us-east-1#/create/function?intent=authorFromImage) > Select **Container image**

    <Warning>Make sure you've selected the right region, this URL defaults to `us-east-1`.</Warning>

    <Frame>
      <img src="https://mintcdn.com/bun-1dd33a4e/TVJ0wXBZobUdB01H/images/guides/lambda1.png?fit=max&auto=format&n=TVJ0wXBZobUdB01H&q=85&s=56e8b0e323726544e2a88c7e39cb2d50" alt="Create Function" width="3116" height="2084" data-path="images/guides/lambda1.png" />
    </Frame>

    Give the function a name, like `my-bun-function`.
  </Step>

  <Step title="Select the container image">
    Then, go to the **Container image URI** section, click on **Browse images**. Select the image we just pushed to the ECR repository.

    <Frame>
      <img src="https://mintcdn.com/bun-1dd33a4e/TVJ0wXBZobUdB01H/images/guides/lambda2.png?fit=max&auto=format&n=TVJ0wXBZobUdB01H&q=85&s=89ab4c81547ef562733fb29b704a9e24" alt="Select Container Repository" width="4128" height="2412" data-path="images/guides/lambda2.png" />
    </Frame>

    Then, select the `latest` image, and click on **Select image**.

    <Frame>
      <img src="https://mintcdn.com/bun-1dd33a4e/TVJ0wXBZobUdB01H/images/guides/lambda3.png?fit=max&auto=format&n=TVJ0wXBZobUdB01H&q=85&s=70906fbda8b366e972615bd297335e9d" alt="Select Container Image" width="4128" height="2172" data-path="images/guides/lambda3.png" />
    </Frame>
  </Step>

  <Step title="Configure the function">
    To get a public URL for the function, we need to go to **Additional configurations** > **Networking** > **Function URL**.

    Set this to **Enable**, with Auth Type **NONE**.

    <Frame>
      <img src="https://mintcdn.com/bun-1dd33a4e/TVJ0wXBZobUdB01H/images/guides/lambda4.png?fit=max&auto=format&n=TVJ0wXBZobUdB01H&q=85&s=48620c8aeb9326875d97a9a17edc8b1e" alt="Set the Function URL" width="3116" height="1524" data-path="images/guides/lambda4.png" />
    </Frame>
  </Step>

  <Step title="Create the function">
    Click on **Create function** at the bottom of the page, this will create the function.

    <Frame>
      <img src="https://mintcdn.com/bun-1dd33a4e/TVJ0wXBZobUdB01H/images/guides/lambda6.png?fit=max&auto=format&n=TVJ0wXBZobUdB01H&q=85&s=f615eda922b34ac37bc5e39a8f08ef25" alt="Create Function" width="4836" height="2516" data-path="images/guides/lambda6.png" />
    </Frame>
  </Step>

  <Step title="Get the function URL">
    Once the function has been created you'll be redirected to the function's page, where you can see the function URL in the **"Function URL"** section.

    <Frame>
      <img src="https://mintcdn.com/bun-1dd33a4e/TVJ0wXBZobUdB01H/images/guides/lambda5.png?fit=max&auto=format&n=TVJ0wXBZobUdB01H&q=85&s=5bc860978a6c636d49c1a73603d0655a" alt="Function URL" width="4792" height="2500" data-path="images/guides/lambda5.png" />
    </Frame>
  </Step>

  <Step title="Test the function">
    🥳 Your app is now live! To test the function, you can either go to the **Test** tab, or call the function URL directly.

    ```bash terminal icon="terminal" theme={"theme":{"light":"github-light","dark":"dracula"}}
    curl -X GET https://[your-function-id].lambda-url.us-east-1.on.aws/
    ```

    ```txt theme={"theme":{"light":"github-light","dark":"dracula"}}
    Hello from Bun on Lambda!
    ```
  </Step>
</Steps>

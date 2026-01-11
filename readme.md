# Job Scheduler

A simple serverless job scheduler built with AWS SAM and Node.js. This
project allows you to define and run scheduled tasks using AWS Lambda
and CloudWatch Events without managing any servers.

## Overview

This repository provides a minimal and practical setup for running
recurring background jobs on AWS. It is well suited for cron-like tasks
such as cleanup jobs, periodic syncs, reporting tasks, or maintenance
scripts.

The focus is on simplicity and clarity rather than abstraction.

## Project Structure

├── src/handlers/ Lambda function handlers\
├── template.yml AWS SAM template

## Prerequisites

Before getting started, make sure you have the following installed and
configured:

-   Node.js (version 14 or later)
-   AWS CLI with valid credentials
-   AWS SAM CLI

## Setup

Clone the repository:

git clone https://github.com/ridhamz/job-scheduler.git\
cd job-scheduler

Install dependencies:

npm install

Create your environment file if needed:

cp .env.example .env

## Build and Deploy

Build the project locally:

sam build

Deploy to AWS:

sam deploy --guided

During deployment, you will be asked to choose a stack name, region, and
permission settings. Once deployed, your scheduled jobs will be active
automatically.

## Adding a Scheduled Job

Each scheduled job is a Lambda function defined in src/handlers and
wired in template.yml.

Example handler:

exports.handler = async () =\> { console.log("Job executed"); };

Example schedule configuration in template.yml:

MyScheduledJob: Type: AWS::Serverless::Function Properties: Handler:
src/handlers/myJob.handler Runtime: nodejs18.x Events: ScheduledEvent:
Type: Schedule Properties: Schedule: cron(0/15 \* \* \* ? \*)

This example runs the job every 15 minutes.

## How It Works

AWS SAM translates the template into CloudFormation resources.
CloudWatch Events trigger the Lambda functions based on the defined
schedule, and the Node.js handlers execute the job logic.

This approach removes the need for a dedicated scheduler server while
keeping scheduling logic close to the code.

## Local Testing

You can invoke a function locally using:

sam local invoke FunctionName

This allows you to validate logic before deploying.

## Contributing

Contributions are welcome. Feel free to add new examples, improve error
handling, or extend the scheduler with logging and monitoring.

## License

Add license information here.
